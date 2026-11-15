import { inSequence } from "@flightdeck/protocol";
import { Decrypter, Encrypter } from "age-encryption";
import { parseJsonText, readStored, validItems } from "@/shared/lib/index.ts";
import type { Platform } from "../../platform/types.ts";
import { HOSTS_KEY, type HostConfig, loadHosts } from "../hosts/index.ts";
// A lazy chunk imports the backup file directly: the vault index leaves it out so `age` stays out of the entry chunk.
import {
  type BackupEntry,
  type ConflictChoice,
  DEFAULT_WORK_FACTOR,
  fromFdvault,
  MIN_PASSPHRASE,
  sameSecret,
  toFdvault,
} from "../vault/domain/vault-backup.ts";
import { Vault } from "../vault/index.ts";
import { BackupError } from "./backup-error.ts";
import {
  BACKUP_SETTING_KEYS,
  type BackupHost,
  Bundle,
  PERSONAS_KEY,
  PREFIX,
  SNIPPETS_KEY,
  VERSION,
} from "./domain/bundle-schema.ts";
import {
  hostLabel,
  Item,
  type Judged,
  judgeItems,
  type KindSummary,
  personaName,
  type Status,
  snippetName,
  statusOf,
  summary,
} from "./domain/restore-judgement.ts";

/** What a backup reads and writes: the app's settings, the host tokens and the vault. */
export type BackupPlatform = Pick<Platform, "storage" | "secrets" | "vault">;

export interface BackupOptions {
  /** scrypt work factor (log2 N); tests lower it to stay fast. */
  workFactor?: number;
  clock?: () => number;
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

/** The decrypted bundle of a preview stays here, so the preview itself can be shown and logged. */
const held = new WeakMap<RestorePreview, Bundle>();

/** A list of the app's own items; one that is not an item is left out, the others stay. */
const readList = (platform: BackupPlatform, key: string): Item[] =>
  readStored(platform.storage, key, validItems(Item), []);

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
    const body = parseJsonText(await decrypter.decrypt(fromFdvault(text), "text"), Bundle, null);
    if (body) return body;
  } catch {
    // Handled below: it looks the same as a bundle that does not fit.
  }
  // A wrong passphrase, a tampered file and a file that is no backup look the same, on purpose.
  throw new BackupError("unreadable");
}

interface Judgement {
  settings: Array<Judged<string>>;
  personas: Array<Judged<Item>>;
  snippets: Array<Judged<Item>>;
  hosts: Array<Judged<BackupHost>>;
  vault: Array<Judged<Bundle["vault"][number]>>;
}

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
    const status = statusOf(mine !== undefined, same);
    judgedHosts.push({ id: host.id, name: hostLabel(host), status, item: host });
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
        const status = statusOf(mine !== null, mine === bundle.settings[key]);
        return { id: key, name: settingName(key), status, item: bundle.settings[key] as string };
      }),
    personas: judgeItems(readList(platform, PERSONAS_KEY), bundle.personas, personaName),
    snippets: judgeItems(readList(platform, SNIPPETS_KEY), bundle.snippets, snippetName),
    hosts: judgedHosts,
    vault: judgedVault,
  };
}

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
  await inSequence(taken(judged.vault), async ({ item: entry }) => {
    const meta = secrets.find((other) => other.id === entry.meta.id);
    const value = meta ? await vault.value(meta.id) : null;
    steps.push({
      apply: () => vault.restore(entry.meta, entry.value),
      undo: () => (meta ? vault.restore(meta, value ?? "") : vault.remove(entry.meta.id)),
    });
  });
  const chosenHosts = taken(judged.hosts).map((one) => one.item);
  await inSequence(
    chosenHosts.filter((host) => host.token !== null),
    async (host) => {
      const token = await platform.secrets.get(host.id);
      steps.push({
        apply: () => platform.secrets.set(host.id, host.token as string),
        undo: () =>
          token === null ? platform.secrets.delete(host.id) : platform.secrets.set(host.id, token),
      });
    },
  );
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
    await inSequence(steps, (step) => {
      done.push(step);
      return step.apply();
    });
  } catch (error) {
    // The step that failed may have done half of its work: it is undone with the others.
    await inSequence([...done].reverse(), (step) => step.undo().catch(() => {}));
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
