import { describe, expect, test } from "bun:test";
import {
  applyRestore,
  type BackupPlatform,
  createBackup,
  previewRestore,
} from "../src/lib/backup-bundle.ts";
import { Vault } from "../src/lib/vault.ts";
import { BackupError } from "../src/lib/vault-backup.ts";

/**
 * Issue #1241: one encrypted file holds the app's settings, personas, snippets, hosts (with their
 * tokens) and vault. A restore previews first, applies all or nothing, and a wrong passphrase or a
 * corrupt file changes nothing. The OS keyring and the app's storage are in memory here.
 */
const PASS = "correct horse battery";
const FAST = { workFactor: 4, clock: () => Date.UTC(2026, 10, 8) };

interface Profile {
  platform: BackupPlatform;
  storage: Map<string, string>;
  tokens: Map<string, string>;
  keyring: Map<string, string>;
  /** Makes the n-th write to the vault fail, to cut an apply in the middle. */
  failVaultSetAt(n: number | null): void;
}

function newProfile(): Profile {
  const storage = new Map<string, string>();
  const tokens = new Map<string, string>();
  const keyring = new Map<string, string>();
  let failAt: number | null = null;
  let sets = 0;
  const platform: BackupPlatform = {
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
    secrets: {
      get: async (id) => tokens.get(id) ?? null,
      set: async (id, value) => {
        tokens.set(id, value);
      },
      delete: async (id) => {
        tokens.delete(id);
      },
    },
    vault: {
      get: async (id) => keyring.get(id) ?? null,
      set: async (id, value) => {
        sets += 1;
        if (failAt !== null && sets === failAt) throw new Error("keyring is locked");
        keyring.set(id, value);
      },
      delete: async (id) => {
        keyring.delete(id);
      },
      generateKey: async () => ({ privateKey: "", publicKey: "" }),
      pickFile: async () => null,
      removeFile: async () => {},
    },
  };
  return {
    platform,
    storage,
    tokens,
    keyring,
    failVaultSetAt: (n) => {
      failAt = n;
      sets = 0;
    },
  };
}

const persona = (id: string, name: string) => ({ id, name, body: `be ${name}` });
const snippet = (id: string, name: string) => ({
  id,
  def: { name, type: "prompt", run: null, text: "hi", vars: {}, tags: [] },
  favorite: false,
  uses: 0,
  lastUsedAt: null,
});

/** A profile with something of every kind. */
async function filled(): Promise<Profile> {
  const profile = newProfile();
  const { storage, tokens, platform } = profile;
  storage.set("flightdeck.theme", "dark");
  storage.set("flightdeck.lang", "en");
  storage.set(
    "flightdeck.personas",
    JSON.stringify([persona("p1", "Reviewer"), persona("p2", "Writer")]),
  );
  storage.set("flightdeck.snippets", JSON.stringify([snippet("s1", "Release notes")]));
  storage.set(
    "flightdeck.hosts",
    JSON.stringify([
      { id: "h1", name: "Workstation", url: "ws://10.0.0.1:7777" },
      { id: "h2", name: "Pi", url: "ws://10.0.0.2:7777" },
    ]),
  );
  tokens.set("h1", "host-token-ONE");
  tokens.set("h2", "host-token-TWO");
  let n = 0;
  const vault = new Vault(platform, { clock: () => 1_000, newId: () => `k${++n}` });
  await vault.create({ name: "GitHub", type: "token", value: "ghp-VAULT-SECRET-1" });
  await vault.create({ name: "Deploy key", type: "password", value: "hunter2-VAULT-SECRET-2" });
  return profile;
}

const snapshot = (profile: Profile) =>
  JSON.stringify([
    [...profile.storage].sort(),
    [...profile.tokens].sort(),
    [...profile.keyring].sort(),
  ]);

describe("backup-bundle: one encrypted file with everything (#1241)", () => {
  test("a backup made on one profile restores on a fresh one, with the preview before", async () => {
    const source = await filled();
    const text = await createBackup(source.platform, PASS, PASS, FAST);
    const fresh = newProfile();
    const before = snapshot(fresh);
    const preview = await previewRestore(fresh.platform, text, PASS);
    const untouched = snapshot(fresh) === before;
    const result = await applyRestore(fresh.platform, preview);
    const vaultNames = new Vault(fresh.platform)
      .list()
      .map((s) => s.name)
      .sort();
    expect([
      preview.hosts.added.sort(),
      preview.personas.added.sort(),
      preview.snippets.added,
      preview.vault.added.sort(),
      preview.settings.added.sort(),
      untouched,
      result,
      fresh.storage.get("flightdeck.theme"),
      fresh.tokens.get("h1"),
      fresh.tokens.get("h2"),
      vaultNames,
      [...fresh.keyring.values()].sort(),
      JSON.parse(fresh.storage.get("flightdeck.personas") ?? "[]").length,
    ]).toEqual([
      ["Pi", "Workstation"],
      ["Reviewer", "Writer"],
      ["Release notes"],
      ["Deploy key", "GitHub"],
      ["lang", "theme"],
      true,
      { added: 9, overwritten: 0, skipped: 0 },
      "dark",
      "host-token-ONE",
      "host-token-TWO",
      ["Deploy key", "GitHub"],
      ["ghp-VAULT-SECRET-1", "hunter2-VAULT-SECRET-2"],
      2,
    ]);
  });

  test("the file holds no secret in clear, and the preview names things without their values", async () => {
    const source = await filled();
    const text = await createBackup(source.platform, PASS, PASS, FAST);
    const preview = await previewRestore(newProfile().platform, text, PASS);
    const everything = text + JSON.stringify(preview);
    expect([
      text.startsWith("-----BEGIN AGE ENCRYPTED FILE-----"),
      everything.includes("host-token-ONE"),
      everything.includes("VAULT-SECRET"),
      everything.includes("ws://10.0.0.1"),
    ]).toEqual([true, false, false, false]);
  });

  test("a short or unconfirmed passphrase writes nothing", async () => {
    const source = await filled();
    const codes = await Promise.all(
      [
        createBackup(source.platform, "short", "short", FAST),
        createBackup(source.platform, PASS, `${PASS}x`, FAST),
      ].map((attempt) =>
        attempt.then(
          () => "written",
          (e: BackupError) => e.code,
        ),
      ),
    );
    expect(codes).toEqual(["short-passphrase", "mismatch"]);
  });

  test("a wrong passphrase, a corrupt file and a file that is no backup read the same and change nothing", async () => {
    const source = await filled();
    const text = await createBackup(source.platform, PASS, PASS, FAST);
    const fresh = newProfile();
    const before = snapshot(fresh);
    const corrupt = `${text.slice(0, 120)}A${text.slice(121)}`;
    const codes = await Promise.all(
      [
        previewRestore(fresh.platform, text, "another passphrase"),
        previewRestore(fresh.platform, corrupt, PASS),
        previewRestore(fresh.platform, "just some text", PASS),
      ].map((attempt) =>
        attempt.then(
          () => "read",
          (e: BackupError) => e.code,
        ),
      ),
    );
    expect([codes, snapshot(fresh) === before]).toEqual([
      ["unreadable", "unreadable", "unreadable"],
      true,
    ]);
  });

  test("the preview lists what differs by name; Skip keeps the local copy, Overwrite takes the backup's", async () => {
    const source = await filled();
    const text = await createBackup(source.platform, PASS, PASS, FAST);
    const target = await filled();
    target.storage.set("flightdeck.theme", "light");
    target.tokens.set("h2", "a-newer-token");
    const preview = await previewRestore(target.platform, text, PASS);
    const skipped = await applyRestore(target.platform, preview, "skip");
    const keptTheme = target.storage.get("flightdeck.theme");
    const keptToken = target.tokens.get("h2");
    const again = await previewRestore(target.platform, text, PASS);
    const overwritten = await applyRestore(target.platform, again, "overwrite");
    expect([
      preview.settings.conflicting,
      preview.hosts.conflicting,
      preview.vault.conflicting,
      preview.personas.same.sort(),
      skipped.skipped > 0,
      keptTheme,
      keptToken,
      overwritten.overwritten > 0,
      target.storage.get("flightdeck.theme"),
      target.tokens.get("h2"),
    ]).toEqual([
      ["theme"],
      ["Pi"],
      [],
      ["Reviewer", "Writer"],
      true,
      "light",
      "a-newer-token",
      true,
      "dark",
      "host-token-TWO",
    ]);
  });

  test("a failure in the middle of the apply puts every kind back as it was", async () => {
    const source = await filled();
    const text = await createBackup(source.platform, PASS, PASS, FAST);
    const target = newProfile();
    target.storage.set("flightdeck.theme", "light");
    target.storage.set("flightdeck.personas", JSON.stringify([persona("p9", "Local only")]));
    target.tokens.set("h9", "local-token");
    const before = snapshot(target);
    const preview = await previewRestore(target.platform, text, PASS);
    target.failVaultSetAt(2);
    const failed = await applyRestore(target.platform, preview, "overwrite").then(
      () => false,
      () => true,
    );
    expect([failed, snapshot(target) === before]).toEqual([true, true]);
  });
});
