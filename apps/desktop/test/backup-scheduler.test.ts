import { describe, expect, test } from "bun:test";
import { backupFileName, loadSchedule } from "../src/lib/backup-schedule.ts";
import { BackupScheduler } from "../src/lib/backup-scheduler.ts";
import { memoryPlatform, waitFor } from "./fixtures.ts";

/**
 * Issue #1264: the app-side owner of the scheduled backups. The passphrase lives in memory only; a
 * run that is owed but cannot go is reported, not silent; the last run is saved only when it worked.
 */
const PASS = "correct horse battery";
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const DAY = 24 * 3_600_000;

function setup(options: { failWrite?: boolean; pick?: string | null } = {}) {
  const { platform } = memoryPlatform(false, "en");
  const files = new Map<string, string>();
  let picked: string | null = "/backups";
  const writes: string[] = [];
  const stored: string[] = [];
  const setItem = platform.storage.setItem.bind(platform.storage);
  platform.storage.setItem = (key: string, value: string) => {
    stored.push(`${key}=${value}`);
    setItem(key, value);
  };
  platform.backupFolder = {
    pick: async () => (options.pick === undefined ? "/backups" : options.pick),
    current: async () => picked,
    write: async (name, text) => {
      if (options.failWrite) throw new Error("disk full");
      writes.push(name);
      files.set(name, text);
    },
    list: async () => [...files.keys()],
    remove: async (name) => {
      files.delete(name);
    },
  };
  const clock = { now: T0 };
  const scheduler = new BackupScheduler(platform, {
    workFactor: 4,
    now: () => clock.now,
    intervalMs: 20,
  });
  return {
    platform,
    scheduler,
    files,
    writes,
    stored,
    clock,
    forget: () => {
      picked = null;
    },
  };
}

describe("backup-scheduler (#1264)", () => {
  test("a platform with no backup folder (the web) is not supported", () => {
    const { platform } = memoryPlatform(false, "en");
    expect(new BackupScheduler(platform).supported).toBe(false);
  });

  test("the picked folder is shown and saved; a cancelled pick changes nothing", async () => {
    const { scheduler, platform } = setup();
    await scheduler.chooseFolder();
    const cancelled = setup({ pick: null });
    await cancelled.scheduler.chooseFolder();
    expect([
      scheduler.folder,
      loadSchedule(platform.storage).folder,
      cancelled.scheduler.folder,
      cancelled.scheduler.schedule().folder,
    ]).toEqual(["/backups", "/backups", null, ""]);
  });

  test("a schedule that is due with no passphrase is skipped and says so, writing nothing", async () => {
    const { scheduler, writes } = setup();
    await scheduler.chooseFolder();
    await scheduler.setCadence("daily");
    expect([scheduler.report, scheduler.hasPassphrase, writes]).toEqual([
      { status: "skipped", reason: "no-passphrase", at: T0 },
      false,
      [],
    ]);
  });

  test("giving the passphrase runs the owed backup; the last run is saved and the passphrase is not", async () => {
    const { scheduler, platform, writes, stored } = setup();
    await scheduler.chooseFolder();
    await scheduler.setCadence("daily");
    await scheduler.setPassphrase(PASS);
    expect([
      writes,
      scheduler.report.status,
      loadSchedule(platform.storage).lastRunAt,
      scheduler.hasPassphrase,
      stored.some((entry) => entry.includes(PASS)),
    ]).toEqual([[backupFileName(T0)], "done", T0, true, false]);
  });

  test("a second tick on the same day does nothing; a day later it runs again", async () => {
    const { scheduler, writes, clock } = setup();
    await scheduler.chooseFolder();
    await scheduler.setCadence("daily");
    await scheduler.setPassphrase(PASS);
    await scheduler.tick();
    const sameDay = writes.length;
    clock.now = T0 + DAY;
    await scheduler.tick();
    expect([sameDay, writes]).toEqual([1, [backupFileName(T0), backupFileName(T0 + DAY)]]);
  });

  test("a write that fails is reported as failed and the last run stays unset", async () => {
    const { scheduler, platform } = setup({ failWrite: true });
    await scheduler.chooseFolder();
    await scheduler.setCadence("daily");
    await scheduler.setPassphrase(PASS);
    expect([scheduler.report, loadSchedule(platform.storage).lastRunAt]).toEqual([
      { status: "skipped", reason: "failed", at: T0 },
      null,
    ]);
  });

  test("the number to keep is saved, never below one", async () => {
    const { scheduler, platform } = setup();
    await scheduler.setKeep(8);
    const eight = loadSchedule(platform.storage).keep;
    await scheduler.setKeep(0);
    expect([eight, loadSchedule(platform.storage).keep, scheduler.schedule().keep]).toEqual([
      8, 1, 1,
    ]);
  });

  test("listeners hear every change", async () => {
    const { scheduler } = setup();
    let heard = 0;
    const off = scheduler.subscribe(() => {
      heard += 1;
    });
    await scheduler.setCadence("weekly");
    off();
    await scheduler.setKeep(2);
    expect([heard > 0, scheduler.version > 0]).toEqual([true, true]);
  });

  test("start shows the stored folder, runs what is owed, then keeps checking until disposed", async () => {
    const { scheduler, writes, clock, forget } = setup();
    await scheduler.chooseFolder();
    await scheduler.setCadence("daily");
    await scheduler.setPassphrase(PASS);
    await scheduler.start();
    clock.now = T0 + DAY;
    await waitFor(() => writes.length === 2 || undefined, "the timer's run").catch(() => null);
    scheduler.dispose();
    clock.now = T0 + 2 * DAY;
    // Nothing should run now: give a stray timer time to show itself, then look.
    await waitFor(() => writes.length > 2 || undefined, "a run after dispose", 100).catch(
      () => null,
    );
    forget();
    await scheduler.start();
    scheduler.dispose();
    expect([writes.length, scheduler.folder]).toEqual([2, null]);
  });
});
