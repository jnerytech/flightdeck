import { describe, expect, test } from "bun:test";
import type { BackupPlatform } from "../src/lib/backup-bundle.ts";
import { previewRestore } from "../src/lib/backup-bundle.ts";
import {
  type BackupFolder,
  type BackupSchedule,
  backupFileName,
  DEFAULT_KEEP,
  isDue,
  loadSchedule,
  runScheduledBackup,
  saveSchedule,
} from "../src/lib/backup-schedule.ts";

/**
 * Issue #1264: a schedule (off, daily or weekly) writes an encrypted backup to a picked folder and
 * keeps the last N files. The passphrase comes from memory; without it the run is skipped and
 * reported. The folder is a fake here: the Rust shell lists and removes only files named like a backup.
 */
const PASS = "correct horse battery";
const FAST = { workFactor: 4 };
const HOUR = 3_600_000;
const NOON = Date.UTC(2026, 10, 8, 12, 0, 0);

function platformWith(withTheme = true): BackupPlatform {
  const items = new Map<string, string>(withTheme ? [["flightdeck.theme", "dark"]] : []);
  const tokens = new Map<string, string>();
  const keyring = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
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
        keyring.set(id, value);
      },
      delete: async (id) => {
        keyring.delete(id);
      },
      generateKey: async () => ({ publicKey: "", privateKey: "" }),
      pickFile: async () => null,
      removeFile: async () => {},
    },
  } as BackupPlatform;
}

/** A folder holding files by name; `files` is what is on disk, `list` is only the backups among them. */
function fakeFolder(initial: string[], options: { failWrite?: boolean } = {}) {
  const files = new Map<string, string>(initial.map((name) => [name, "old"]));
  const pattern = /^flightdeck-backup-\d{8}-\d{6}\.fdbackup$/;
  const folder: BackupFolder = {
    pick: async () => "/backups",
    current: async () => "/backups",
    write: async (name, text) => {
      if (options.failWrite) throw new Error("disk full");
      files.set(name, text);
    },
    list: async () => [...files.keys()].filter((name) => pattern.test(name)),
    remove: async (name) => {
      files.delete(name);
    },
  };
  return { folder, files };
}

const schedule = (patch: Partial<BackupSchedule> = {}): BackupSchedule => ({
  cadence: "daily",
  folder: "/backups",
  keep: 3,
  lastRunAt: null,
  ...patch,
});
const named = (day: number) =>
  `flightdeck-backup-202611${String(day).padStart(2, "0")}-120000.fdbackup`;

describe("backup-schedule: when it is due and what the file is called (#1264)", () => {
  test("off is never due; daily after a day; weekly after seven; never run is due; no folder is not", () => {
    expect([
      isDue(schedule({ cadence: "off" }), NOON),
      isDue(schedule({ lastRunAt: null }), NOON),
      isDue(schedule({ lastRunAt: NOON - 23 * HOUR }), NOON),
      isDue(schedule({ lastRunAt: NOON - 24 * HOUR }), NOON),
      isDue(schedule({ cadence: "weekly", lastRunAt: NOON - 6 * 24 * HOUR }), NOON),
      isDue(schedule({ cadence: "weekly", lastRunAt: NOON - 7 * 24 * HOUR }), NOON),
      isDue(schedule({ folder: "" }), NOON),
    ]).toEqual([false, true, false, true, false, true, false]);
  });

  test("the file name is the UTC time, so names sort by age", () => {
    expect([backupFileName(NOON), backupFileName(NOON) < backupFileName(NOON + 1000)]).toEqual([
      "flightdeck-backup-20261108-120000.fdbackup",
      true,
    ]);
  });

  test("a schedule that is saved loads again; an unset or damaged one is off with the default keep", () => {
    const { storage } = platformWith();
    const untouched = loadSchedule(storage);
    saveSchedule(storage, schedule({ cadence: "weekly", keep: 7, lastRunAt: NOON }));
    const saved = loadSchedule(storage);
    storage.setItem("flightdeck.backupSchedule", "{not json");
    const damaged = loadSchedule(storage);
    expect([untouched, saved, damaged]).toEqual([
      { cadence: "off", folder: "", keep: DEFAULT_KEEP, lastRunAt: null },
      { cadence: "weekly", folder: "/backups", keep: 7, lastRunAt: NOON },
      { cadence: "off", folder: "", keep: DEFAULT_KEEP, lastRunAt: null },
    ]);
  });
});

describe("backup-schedule: a run (#1264)", () => {
  test("a run writes an encrypted backup and keeps exactly the last N, touching nothing else", async () => {
    const { folder, files } = fakeFolder([
      named(1),
      named(2),
      named(3),
      named(4),
      named(5),
      "notes.txt",
    ]);
    const platform = platformWith();
    const report = await runScheduledBackup({
      platform,
      folder,
      schedule: schedule({ keep: 3 }),
      passphrase: PASS,
      now: NOON,
      options: FAST,
    });
    const name = backupFileName(NOON);
    const text = files.get(name) ?? "";
    // The preview reads the file the run wrote; with nothing written there is nothing to read.
    const preview = text === "" ? null : await previewRestore(platformWith(false), text, PASS);
    expect([
      report,
      [...files.keys()].sort(),
      text.startsWith("-----BEGIN AGE ENCRYPTED FILE-----"),
      text.includes("dark"),
      preview?.settings.added,
    ]).toEqual([
      { status: "done", name, kept: 3, removed: 3, prune: "ok", at: NOON },
      ["flightdeck-backup-20261108-120000.fdbackup", named(4), named(5), "notes.txt"].sort(),
      true,
      false,
      ["theme"],
    ]);
  });

  test("the file just written is never the one pruned, even beside a backup dated later", async () => {
    const later = "flightdeck-backup-99991231-235959.fdbackup";
    const { folder, files } = fakeFolder([named(1), later]);
    const report = await runScheduledBackup({
      platform: platformWith(),
      folder,
      schedule: schedule({ keep: 1 }),
      passphrase: PASS,
      now: NOON,
      options: FAST,
    });
    const name = backupFileName(NOON);
    expect([report.status === "done" && report.removed, [...files.keys()]]).toEqual([2, [name]]);
  });

  test("a backup that was written but could not be pruned is reported as done, not as a failure", async () => {
    const { folder, files } = fakeFolder([named(1)]);
    folder.list = async () => {
      throw new Error("folder went away");
    };
    const report = await runScheduledBackup({
      platform: platformWith(),
      folder,
      schedule: schedule({ keep: 1 }),
      passphrase: PASS,
      now: NOON,
      options: FAST,
    });
    expect([report.status === "done" && report.prune, files.has(backupFileName(NOON))]).toEqual([
      "failed",
      true,
    ]);
  });

  test("a schedule saves only its own four fields", () => {
    const { storage } = platformWith();
    saveSchedule(storage, { ...schedule(), passphrase: PASS } as BackupSchedule);
    expect(storage.getItem("flightdeck.backupSchedule")?.includes(PASS)).toBe(false);
  });

  test("a keep below one never empties the folder", async () => {
    const { folder, files } = fakeFolder([named(1), named(2)]);
    await runScheduledBackup({
      platform: platformWith(),
      folder,
      schedule: schedule({ keep: 0 }),
      passphrase: PASS,
      now: NOON,
      options: FAST,
    });
    expect([...files.keys()]).toEqual([backupFileName(NOON)]);
  });

  test("no passphrase, no folder or no folder access skips the run and says why, writing nothing", async () => {
    const { folder, files } = fakeFolder([named(1)]);
    const base = { platform: platformWith(), now: NOON, options: FAST };
    const reports = [
      await runScheduledBackup({ ...base, folder, schedule: schedule(), passphrase: null }),
      await runScheduledBackup({
        ...base,
        folder,
        schedule: schedule({ folder: "" }),
        passphrase: PASS,
      }),
      await runScheduledBackup({
        ...base,
        folder: undefined,
        schedule: schedule(),
        passphrase: PASS,
      }),
    ];
    expect([reports, [...files.keys()]]).toEqual([
      [
        { status: "skipped", reason: "no-passphrase", at: NOON },
        { status: "skipped", reason: "no-folder", at: NOON },
        { status: "skipped", reason: "no-folder", at: NOON },
      ],
      [named(1)],
    ]);
  });

  test("a write that fails is reported and removes nothing", async () => {
    const { folder, files } = fakeFolder([named(1), named(2), named(3), named(4)], {
      failWrite: true,
    });
    const report = await runScheduledBackup({
      platform: platformWith(),
      folder,
      schedule: schedule({ keep: 2 }),
      passphrase: PASS,
      now: NOON,
      options: FAST,
    });
    expect([report, [...files.keys()].length]).toEqual([
      { status: "skipped", reason: "failed", at: NOON },
      4,
    ]);
  });

  test("a run that is not due, or a schedule that is off, does nothing", async () => {
    const { folder, files } = fakeFolder([]);
    const base = { platform: platformWith(), folder, passphrase: PASS, now: NOON, options: FAST };
    const reports = [
      await runScheduledBackup({ ...base, schedule: schedule({ cadence: "off" }) }),
      await runScheduledBackup({ ...base, schedule: schedule({ lastRunAt: NOON - HOUR }) }),
    ];
    expect([reports, files.size]).toEqual([[{ status: "idle" }, { status: "idle" }], 0]);
  });
});
