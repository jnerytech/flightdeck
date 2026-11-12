import { describe, expect, test } from "bun:test";
import { createBackup } from "../../src/features/backup/backup-bundle.ts";
import { fakeGoogle } from "../fake-google.ts";
import { memoryPlatform } from "../fixtures.ts";

/**
 * Issue #1462: restoring from Google Drive. The store lists the app's backups on Drive, newest
 * first, and reads one into the same preview as a file; the restore itself is the one of #1241.
 */
const PASS = "correct horse battery";
const NAME = (day: number) =>
  `flightdeck-backup-202611${String(day).padStart(2, "0")}-120000.fdbackup`;

const { AppStore } = await import("../../src/lib/app-store.ts");

async function setup(options: { signedIn?: boolean; clientId?: string | null } = {}) {
  const source = memoryPlatform(false, "en");
  source.platform.storage.setItem("flightdeck.theme", "dark");
  const bundle = await createBackup(source.platform, PASS, PASS, { workFactor: 4 });

  const { platform } = memoryPlatform(false, "en");
  const google = fakeGoogle();
  const keyring = new Map<string, string>();
  const opened: string[] = [];
  platform.vault.get = async (id: string) => keyring.get(id) ?? null;
  platform.vault.set = async (id: string, value: string) => {
    keyring.set(id, value);
  };
  platform.vault.delete = async (id: string) => {
    keyring.delete(id);
  };
  platform.openExternal = async (url: string) => {
    opened.push(url);
  };
  platform.backupFolder = {
    pick: async () => "/b",
    current: async () => "/b",
    write: async () => {},
    list: async () => [],
    remove: async () => {},
  };
  platform.oauthLoopback = {
    listen: async (state: string) => ({
      port: 4567,
      wait: async () => ({ code: "the-code", state }),
      cancel: () => {},
    }),
  };
  const clientId = options.clientId === undefined ? "client-1" : options.clientId;
  const store = new AppStore(platform, {
    baseDelayMs: 600_000,
    vaultWorkFactor: 4,
    google: { config: clientId === null ? null : { clientId }, fetch: google.fetch },
  });
  if (options.signedIn !== false) await store.backupScheduler.signInDrive();
  const put = (name: string, text: string, id = name) =>
    google.drive.files.set(id, { name, parents: ["appDataFolder"], text });
  return { store, platform, google, bundle, put };
}

describe("restore from Google Drive (#1462)", () => {
  test("lists the backups on Drive, newest first, and nothing that is not a backup", async () => {
    const { store, put } = await setup();
    put(NAME(2), "x");
    put(NAME(9), "x");
    put("notes.txt", "x");
    put(NAME(5), "x");
    expect(await store.backup.driveList()).toEqual({
      ok: true,
      names: [NAME(9), NAME(5), NAME(2)],
    });
  });

  test("reads one backup into the preview that a file gives, and the restore applies it", async () => {
    const { store, platform, put, bundle } = await setup();
    put(NAME(3), bundle);
    const read = await store.backup.previewDrive(NAME(3), PASS);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.preview.settings.added).toEqual(["theme"]);
    const restored = await store.backup.restore(read.preview, "skip");
    expect(restored.ok).toBe(true);
    expect(platform.storage.getItem("flightdeck.theme")).toBe("dark");
  });

  test("a wrong passphrase is unreadable and changes nothing", async () => {
    const { store, platform, put, bundle } = await setup();
    put(NAME(3), bundle);
    expect(await store.backup.previewDrive(NAME(3), "not the passphrase")).toEqual({
      ok: false,
      code: "unreadable",
    });
    expect(platform.storage.getItem("flightdeck.theme")).toBeNull();
  });

  test("a backup that is not on Drive, or is too big, is a failure and not a preview", async () => {
    const { store, put } = await setup();
    put(NAME(4), "a".repeat(1024 * 1024 + 1));
    expect(await store.backup.previewDrive(NAME(4), PASS)).toEqual({ ok: false, code: "too-big" });
    expect(await store.backup.previewDrive(NAME(8), PASS)).toEqual({
      ok: false,
      code: "drive-failed",
    });
  });

  test("signed out, or revoked, is drive-auth; no Drive in the build is drive-auth too", async () => {
    const out = await setup({ signedIn: false });
    expect(await out.store.backup.driveList()).toEqual({ ok: false, code: "drive-auth" });
    expect(await out.store.backup.previewDrive(NAME(3), PASS)).toEqual({
      ok: false,
      code: "drive-auth",
    });
    const none = await setup({ clientId: null, signedIn: false });
    expect(await none.store.backup.driveList()).toEqual({ ok: false, code: "drive-auth" });
    const revoked = await setup();
    revoked.google.oauth.refreshTokens.clear();
    revoked.google.drive.accept.clear();
    expect(await revoked.store.backup.driveList()).toEqual({ ok: false, code: "drive-auth" });
  });

  test("a Drive that cannot be reached is drive-failed", async () => {
    const { store, google } = await setup();
    google.oauth.offline = true;
    google.drive.accept.clear();
    expect(await store.backup.driveList()).toEqual({ ok: false, code: "drive-failed" });
  });
});
