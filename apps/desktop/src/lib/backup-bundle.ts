import { inSequence } from "@flightdeck/protocol";
import { Decrypter, Encrypter } from "age-encryption";
import { z } from "zod";
import type { Platform } from "../platform/types.ts";
import { BackupError } from "./backup-error.ts";
import { HOSTS_KEY, type HostConfig, loadHosts } from "./hosts.ts";
import { Vault } from "./vault.ts";
import {
  type BackupEntry,
  type ConflictChoice,
  DEFAULT_WORK_FACTOR,
  fromFdvault,
  MIN_PASSPHRASE,
  sameSecret,
  toFdvault,
} from "./vault-backup.ts";

/** What a backup reads and writes: the app's settings, the host tokens and the vault. */
export type BackupPlatform = Pick<Platform, "storage" | "secrets" | "vault">;

export interface BackupOptions {
  /** scrypt work factor (log2 N); tests lower it to stay fast. */
  workFactor?: number;
  clock?: () => number;
}

/** What a restore would do with one kind of data, by name; never a value. */
export interface KindSummary {
  added: string[];
  same: string[];
  conflicting: string[];
}

export interface RestorePreview {
  createdAt: string;
  settings: KindSummary;
  personas: KindSummary;
  snippets: KindSummary;
  hosts: KindSummary;
  vault: KindSummary;
}

export interface RestoreResult {
  added: number;
  overwritten: number;
  skipped: number;
}

const VERSION = 1;
const PREFIX = "flightdeck.";
const PERSONAS_KEY = `${PREFIX}personas`;
const SNIPPETS_KEY = `${PREFIX}snippets`;

/**
 * The preference keys a backup carries, by name. A key outside this list is window state, a log, a
 * cache or something of this machine only (a path): it is never written by a restore, whatever
 * the file says.
 */
export const BACKUP_SETTING_KEYS = [
  "theme",
  "lang",
  "density",
  "notifyPrefs",
  "newSessionPrefs",
  "uiMode",
  "roi",
  "cacheTimer",
  "cacheTtl",
  "clients",
  "clientBudgetAlerts",
  "assistant",
  "vaultRules",
].map((name) => `${PREFIX}${name}`);

const Host = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  token: z.string().nullable(),
});
type BackupHost = z.infer<typeof Host>;

const Entry = z.object({
  meta: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["ssh-key", "password", "token", "env"]),
    description: z.string(),
    tags: z.array(z.string()),
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
    allowedHosts: z.array(z.string()),
  }),
  value: z.string(),
});

/** Personas and snippets are lists of the app's own items, each with an id. */
const Item = z.object({ id: z.string() }).passthrough();
type Item = z.infer<typeof Item>;

const Bundle = z.object({
  kind: z.literal("flightdeck-backup"),
  version: z.literal(VERSION),
  createdAt: z.string(),
  settings: z.record(z.string(), z.string()),
  personas: z.array(Item),
  snippets: z.array(Item),
  hosts: z.array(Host),
  vault: z.array(Entry),
});
type Bundle = z.infer<typeof Bundle>;

/** The decrypted bundle of a preview stays here, so the preview itself can be shown and logged. */
const held = new WeakMap<RestorePreview, Bundle>();

const readList = (platform: BackupPlatform, key: string): Item[] => {
  try {
    const parsed = z.array(Item).safeParse(JSON.parse(platform.storage.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

const personaName = (item: Item) => String(item.name ?? item.id);
const snippetName = (item: Item) =>
  String((item.def as { name?: unknown } | undefined)?.name ?? item.id);
const settingName = (key: string) => key.slice(PREFIX.length);

/** Issue #1241: the whole backup as the armored text of one encrypted file. */
export async function createBackup(
  platform: BackupPlatform,
  passphrase: string,
  confirmation: string,
  options: BackupOptions = {},
): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupError("short-passphrase");
  if (passphrase !== confirmation) throw new BackupError("mismatch");
  const settings: Record<string, string> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const value = platform.storage.getItem(key);
    if (value !== null) settings[key] = value;
  }
  const hosts: BackupHost[] = [];
  await inSequence(loadHosts(platform.storage), async (host) => {
    hosts.push({ ...host, token: await platform.secrets.get(host.id) });
  });
  const vault = new Vault(platform);
  const entries: BackupEntry[] = [];
  await inSequence(vault.list(), async (meta) => {
    const value = await vault.value(meta.id);
    if (value !== null) entries.push({ meta, value });
  });
  const bundle: Bundle = {
    kind: "flightdeck-backup",
    version: VERSION,
    createdAt: new Date((options.clock ?? Date.now)()).toISOString(),
    settings,
    personas: readList(platform, PERSONAS_KEY),
    snippets: readList(platform, SNIPPETS_KEY),
    hosts,
    vault: entries,
  };
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(options.workFactor ?? DEFAULT_WORK_FACTOR);
  return toFdvault(await encrypter.encrypt(JSON.stringify(bundle)));
}

async function readBundle(text: string, passphrase: string): Promise<Bundle> {
  try {
    const decrypter = new Decrypter();
    decrypter.addPassphrase(passphrase);
    const body = JSON.parse(await decrypter.decrypt(fromFdvault(text), "text"));
    return Bundle.parse(body);
  } catch {
    // A wrong passphrase, a tampered file and a file that is no backup look the same, on purpose.
    throw new BackupError("unreadable");
  }
}

type Status = "added" | "same" | "conflicting";

/** One thing of the bundle, what it is called, and how it stands against this profile right now. */
interface Judged<T> {
  id: string;
  name: string;
  status: Status;
  item: T;
}

interface Judgement {
  settings: Array<Judged<string>>;
  personas: Array<Judged<Item>>;
  snippets: Array<Judged<Item>>;
  hosts: Array<Judged<BackupHost>>;
  vault: Array<Judged<Bundle["vault"][number]>>;
}

const judgeItems = (locals: Item[], incoming: Item[], name: (item: Item) => string) =>
  incoming.map((item): Judged<Item> => {
    const mine = locals.find((other) => other.id === item.id);
    const status: Status = !mine
      ? "added"
      : JSON.stringify(mine) === JSON.stringify(item)
        ? "same"
        : "conflicting";
    return { id: item.id, name: name(item), status, item };
  });

/**
 * Compares the bundle with the profile as it is now. The preview shows its names; the apply runs it
 * again and decides by id, so a profile that changed since the preview is not overwritten by what
 * the preview saw, and two things with one name never share a verdict.
 */
async function judge(platform: BackupPlatform, bundle: Bundle): Promise<Judgement> {
  const hosts = loadHosts(platform.storage);
  const vault = new Vault(platform);
  const secrets = vault.list();
  const judgedHosts: Judgement["hosts"] = [];
  await inSequence(bundle.hosts, async (host) => {
    const mine = hosts.find((other) => other.id === host.id);
    const same =
      mine !== undefined &&
      mine.name === host.name &&
      mine.url === host.url &&
      (await platform.secrets.get(host.id)) === host.token;
    const status: Status = !mine ? "added" : same ? "same" : "conflicting";
    judgedHosts.push({ id: host.id, name: host.name, status, item: host });
  });
  const judgedVault: Judgement["vault"] = [];
  await inSequence(bundle.vault, async (entry) => {
    const meta = secrets.find((other) => other.id === entry.meta.id);
    let status: Status = "added";
    if (meta) {
      const current: BackupEntry = { meta, value: (await vault.value(meta.id)) ?? "" };
      status = sameSecret(current, entry) ? "same" : "conflicting";
    }
    judgedVault.push({ id: entry.meta.id, name: entry.meta.name, status, item: entry });
  });
  return {
    settings: Object.keys(bundle.settings)
      .filter((key) => BACKUP_SETTING_KEYS.includes(key))
      .map((key): Judged<string> => {
        const mine = platform.storage.getItem(key);
        const status: Status =
          mine === null ? "added" : mine === bundle.settings[key] ? "same" : "conflicting";
        return { id: key, name: settingName(key), status, item: bundle.settings[key] as string };
      }),
    personas: judgeItems(readList(platform, PERSONAS_KEY), bundle.personas, personaName),
    snippets: judgeItems(readList(platform, SNIPPETS_KEY), bundle.snippets, snippetName),
    hosts: judgedHosts,
    vault: judgedVault,
  };
}

const summary = (judged: Array<Judged<unknown>>): KindSummary => {
  const names = (status: Status) =>
    Object.freeze(judged.filter((one) => one.status === status).map((one) => one.name));
  return Object.freeze({
    added: names("added"),
    same: names("same"),
    conflicting: names("conflicting"),
  }) as KindSummary;
};

/** Reads a backup and compares it with this profile; changes nothing. */
export async function previewRestore(
  platform: BackupPlatform,
  text: string,
  passphrase: string,
): Promise<RestorePreview> {
  const bundle = await readBundle(text, passphrase);
  const judged = await judge(platform, bundle);
  const preview: RestorePreview = Object.freeze({
    createdAt: bundle.createdAt,
    settings: summary(judged.settings),
    personas: summary(judged.personas),
    snippets: summary(judged.snippets),
    hosts: summary(judged.hosts),
    vault: summary(judged.vault),
  });
  held.set(preview, bundle);
  return preview;
}

/** One change with the way back to what it found. */
interface Step {
  apply(): Promise<void>;
  undo(): Promise<void>;
}

/**
 * Applies a preview all or nothing: any failure puts the profile back as it was. A preview applies
 * once; what is replaced is judged again against the profile as it is now.
 */
export async function applyRestore(
  platform: BackupPlatform,
  preview: RestorePreview,
  onConflict: ConflictChoice = "skip",
): Promise<RestoreResult> {
  const bundle = held.get(preview);
  if (!bundle) throw new BackupError("unreadable");
  const judged = await judge(platform, bundle);
  const taken = <T>(all: Array<Judged<T>>) =>
    all.filter(
      (one) =>
        one.status === "added" || (onConflict === "overwrite" && one.status === "conflicting"),
    );
  const vault = new Vault(platform);
  const secrets = vault.list();
  const steps: Step[] = [];
  const storageStep = (key: string, value: string): Step => {
    const before = platform.storage.getItem(key);
    return {
      apply: async () => platform.storage.setItem(key, value),
      // `storage` cannot delete a key: an empty value reads as absent everywhere.
      undo: async () => platform.storage.setItem(key, before ?? ""),
    };
  };
  // The keyring and the host tokens can fail, and can be undone: they go first. The plain
  // settings go last, where only a full disk can stop them.
  for (const { item: entry } of taken(judged.vault)) {
    const meta = secrets.find((other) => other.id === entry.meta.id);
    const value = meta ? await vault.value(meta.id) : null;
    steps.push({
      apply: () => vault.restore(entry.meta, entry.value),
      undo: () => (meta ? vault.restore(meta, value ?? "") : vault.remove(entry.meta.id)),
    });
  }
  const chosenHosts = taken(judged.hosts).map((one) => one.item);
  for (const host of chosenHosts) {
    if (host.token === null) continue;
    const token = await platform.secrets.get(host.id);
    steps.push({
      apply: () => platform.secrets.set(host.id, host.token as string),
      undo: () =>
        token === null ? platform.secrets.delete(host.id) : platform.secrets.set(host.id, token),
    });
  }
  const merged = (key: string, chosen: Item[]) => {
    if (chosen.length === 0) return;
    const ids = new Set(chosen.map((item) => item.id));
    const next = [...readList(platform, key).filter((item) => !ids.has(item.id)), ...chosen];
    steps.push(storageStep(key, JSON.stringify(next)));
  };
  merged(
    PERSONAS_KEY,
    taken(judged.personas).map((one) => one.item),
  );
  merged(
    SNIPPETS_KEY,
    taken(judged.snippets).map((one) => one.item),
  );
  if (chosenHosts.length > 0) {
    const ids = new Set(chosenHosts.map((host) => host.id));
    const next: HostConfig[] = [
      ...loadHosts(platform.storage).filter((host) => !ids.has(host.id)),
      ...chosenHosts.map(({ id, name, url }) => ({ id, name, url })),
    ];
    steps.push(storageStep(HOSTS_KEY, JSON.stringify(next)));
  }
  for (const one of taken(judged.settings)) steps.push(storageStep(one.id, one.item));
  const done: Step[] = [];
  try {
    for (const step of steps) {
      done.push(step);
      await step.apply();
    }
  } catch (error) {
    // The step that failed may have done half of its work: it is undone with the others.
    for (const step of done.reverse()) await step.undo().catch(() => {});
    throw error;
  }
  held.delete(preview);
  const kinds: Array<Array<Judged<unknown>>> = Object.values(judged);
  const count = (status: Status) =>
    kinds.reduce((sum, kind) => sum + kind.filter((one) => one.status === status).length, 0);
  return {
    added: count("added"),
    overwritten: onConflict === "overwrite" ? count("conflicting") : 0,
    skipped: onConflict === "skip" ? count("conflicting") : 0,
  };
}
