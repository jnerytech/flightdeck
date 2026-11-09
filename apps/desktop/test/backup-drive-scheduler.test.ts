import { describe, expect, test } from "bun:test";
import { backupFileName, loadSchedule } from "../src/lib/backup-schedule.ts";
import { BackupScheduler } from "../src/lib/backup-scheduler.ts";
import { REFRESH_TOKEN_ID } from "../src/lib/google-oauth.ts";
import { fakeGoogle } from "./fake-google.ts";
import { memoryPlatform } from "./fixtures.ts";

/**
 * Issue #1444: the scheduler can send its backups to Google Drive. The option exists only where a
 * client id is configured and the shell can listen on the loopback; the tokens live in the vault; a
 * sign-in Google no longer honours is reported, not silent. Google is a fake: nothing real is touched.
 */
const PASS = "correct horse battery";
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const DAY = 24 * 3_600_000;

function setup(options: { clientId?: string | null; loopback?: boolean } = {}) {
  const { platform } = memoryPlatform(false, "en");
  const google = fakeGoogle();
  const keyring = new Map<string, string>();
  const stored: string[] = [];
  const setItem = platform.storage.setItem.bind(platform.storage);
  platform.storage.setItem = (key: string, value: string) => {
    stored.push(`${key}=${value}`);
    setItem(key, value);
  };
  platform.vault.get = async (id: string) => keyring.get(id) ?? null;
  platform.vault.set = async (id: string, value: string) => {
    keyring.set(id, value);
  };
  platform.vault.delete = async (id: string) => {
    keyring.delete(id);
  };
  const opened: string[] = [];
  platform.openExternal = async (url: string) => {
    opened.push(url);
  };
  const folderWrites: string[] = [];
  platform.backupFolder = {
    pick: async () => "/backups",
    current: async () => "/backups",
    write: async (name) => {
      folderWrites.push(name);
    },
    list: async () => [],
    remove: async () => {},
  };
  if (options.loopback !== false) {
    platform.oauthLoopback = {
      listen: async () => ({
        port: 4567,
        wait: async () => ({
          code: "the-code",
          state: new URL(opened.at(-1) ?? "http://x").searchParams.get("state") ?? "",
        }),
        cancel: () => {},
      }),
    };
  }
  const clock = { now: T0 };
  const asked: string[] = [];
  const clientId = options.clientId === undefined ? "client-1" : options.clientId;
  const scheduler = new BackupScheduler(platform, {
    workFactor: 4,
    now: () => clock.now,
    intervalMs: 60_000,
    onAttention: (kind) => asked.push(kind),
    google: { config: clientId === null ? null : { clientId }, fetch: google.fetch },
  });
  return { scheduler, platform, google, keyring, stored, clock, asked, folderWrites };
}

async function onDrive(s: ReturnType<typeof setup>) {
  await s.scheduler.start();
  s.scheduler.setTarget("drive");
  await s.scheduler.signInDrive();
  await s.scheduler.setCadence("daily");
  await s.scheduler.setPassphrase(PASS);
}

describe("BackupScheduler: Google Drive (#1444)", () => {
  test("Drive is offered only with a client id and a loopback listener", () => {
    expect([
      setup().scheduler.driveAvailable,
      setup({ clientId: null }).scheduler.driveAvailable,
      setup({ loopback: false }).scheduler.driveAvailable,
    ]).toEqual([true, false, false]);
  });

  test("signing in keeps the refresh token in the vault and no token in the saved settings", async () => {
    const s = setup();
    await s.scheduler.start();
    expect(await s.scheduler.signInDrive()).toBe("signed-in");
    expect(s.scheduler.driveSignedIn).toBe(true);
    expect([...s.keyring.keys()]).toEqual([REFRESH_TOKEN_ID]);
    expect(s.stored.some((entry) => /refresh-1|access-/.test(entry))).toBe(false);
  });

  test("the chosen target is saved", async () => {
    const s = setup();
    await s.scheduler.start();
    s.scheduler.setTarget("drive");
    expect([s.scheduler.schedule().target, loadSchedule(s.platform.storage).target]).toEqual([
      "drive",
      "drive",
    ]);
  });

  test("choosing Drive where it is not available keeps the folder as the target", async () => {
    const s = setup({ clientId: null });
    await s.scheduler.start();
    s.scheduler.setTarget("drive");
    expect([s.scheduler.schedule().target, loadSchedule(s.platform.storage).target]).toEqual([
      "folder",
      "folder",
    ]);
  });

  test("a start finds the sign-in a token already in the vault stands for", async () => {
    const s = setup();
    s.keyring.set(REFRESH_TOKEN_ID, "refresh-1");
    expect(s.scheduler.driveSignedIn).toBe(false);
    await s.scheduler.start();
    expect(s.scheduler.driveSignedIn).toBe(true);
  });

  test("an owed backup goes to Drive, not to the folder, and the last run is saved", async () => {
    const s = setup();
    await onDrive(s);
    const [file] = [...s.google.drive.files.values()];
    expect(file?.name).toBe(backupFileName(T0));
    expect(file?.parents).toEqual(["appDataFolder"]);
    expect(file?.text.startsWith("-----BEGIN AGE ENCRYPTED FILE-----")).toBe(true);
    expect(s.folderWrites).toEqual([]);
    expect([s.scheduler.report.status, loadSchedule(s.platform.storage).lastRunAt]).toEqual([
      "done",
      T0,
    ]);
  });

  test("a day later the access token is renewed from the vault and the backup goes on", async () => {
    const s = setup();
    await onDrive(s);
    s.clock.now = T0 + DAY;
    await s.scheduler.tick();
    expect([...s.google.drive.files.values()].map((file) => file.name)).toEqual([
      backupFileName(T0),
      backupFileName(T0 + DAY),
    ]);
    expect(s.google.oauth.requests.at(-1)?.grant_type).toBe("refresh_token");
  });

  test("owed but not signed in: skipped as drive-auth, said once, nothing sent to Google", async () => {
    const s = setup();
    await s.scheduler.start();
    s.scheduler.setTarget("drive");
    await s.scheduler.setCadence("daily");
    await s.scheduler.setPassphrase(PASS);
    await s.scheduler.tick();
    expect(s.scheduler.report).toEqual({ status: "skipped", reason: "drive-auth", at: T0 });
    expect(s.asked).toEqual(["passphrase", "drive-auth"]);
    expect(s.google.drive.calls.length).toBe(0);
  });

  test("a sign-in Google revokes shows as signed out and is reported", async () => {
    const s = setup();
    await onDrive(s);
    s.google.oauth.refreshTokens.clear();
    s.google.drive.accept.clear();
    s.clock.now = T0 + DAY;
    await s.scheduler.tick();
    expect([s.scheduler.report.status, s.scheduler.driveSignedIn, s.keyring.size]).toEqual([
      "skipped",
      false,
      0,
    ]);
    expect(s.asked).toEqual(["passphrase", "drive-auth"]);
  });

  test("signing out removes the token; the schedule then waits for a new sign-in", async () => {
    const s = setup();
    await onDrive(s);
    expect([s.scheduler.driveSignedIn, s.keyring.size]).toEqual([true, 1]);
    await s.scheduler.signOutDrive();
    expect([s.scheduler.driveSignedIn, s.keyring.size]).toEqual([false, 0]);
    const calls = s.google.drive.calls.length;
    s.clock.now = T0 + DAY;
    await s.scheduler.tick();
    expect(s.scheduler.report).toEqual({ status: "skipped", reason: "drive-auth", at: T0 + DAY });
    expect(s.google.drive.calls.length).toBe(calls);
  });

  test("without a client id a saved Drive target falls back to the folder", async () => {
    const s = setup({ clientId: null });
    await s.scheduler.start();
    s.platform.storage.setItem(
      "flightdeck.backupSchedule",
      JSON.stringify({ cadence: "daily", target: "drive", folder: "/backups", keep: 5 }),
    );
    const again = new BackupScheduler(s.platform, {
      workFactor: 4,
      now: () => T0,
      intervalMs: 60_000,
    });
    await again.start();
    await again.setPassphrase(PASS);
    expect([s.folderWrites.length, s.google.drive.files.size]).toEqual([1, 0]);
  });
});
