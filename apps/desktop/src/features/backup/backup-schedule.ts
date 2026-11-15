import { z } from "zod";
import { readStored } from "@/shared/lib/index.ts";
import type { BackupOptions, BackupPlatform } from "./backup-bundle.ts";
import { type BackupFolder, folderTarget } from "./backup-target.ts";
import { type BackupSchedule, DEFAULT_KEEP, type RunReport } from "./domain/backup-schedule.ts";
import type { BackupTarget } from "./domain/backup-target.ts";
import { type RunPorts, runDueBackup } from "./domain/run-schedule.ts";
import { DriveError } from "./drive-target.ts";

/** Issue #1264: scheduled backups to a picked folder, keeping the last N files. */
export const SCHEDULE_KEY = "flightdeck.backupSchedule";

export type { BackupFolder };

const OFF: BackupSchedule = {
  cadence: "off",
  target: "folder",
  folder: "",
  keep: DEFAULT_KEEP,
  lastRunAt: null,
};

/** The schedule as kept: a field of the wrong type reads as its default, the others stay. */
const Saved = z.object({
  cadence: z.enum(["off", "daily", "weekly"]).catch("off"),
  target: z.enum(["folder", "drive"]).catch("folder"),
  folder: z.string().catch(""),
  keep: z.number().int().min(1).catch(DEFAULT_KEEP),
  lastRunAt: z.number().nullable().catch(null),
});

/** The saved schedule; an unset or damaged one is off. */
export function loadSchedule(storage: BackupPlatform["storage"]): BackupSchedule {
  return readStored(storage, SCHEDULE_KEY, Saved, { ...OFF });
}

export function saveSchedule(storage: BackupPlatform["storage"], schedule: BackupSchedule): void {
  // Only the four fields: whatever else the object carries is not written.
  const { cadence, target, folder, keep, lastRunAt } = schedule;
  storage.setItem(SCHEDULE_KEY, JSON.stringify({ cadence, target, folder, keep, lastRunAt }));
}

const PORTS: RunPorts<BackupPlatform, BackupOptions, BackupFolder> = {
  // Loaded when a backup runs, so the encryption library stays out of the start-up chunk.
  createBackup: async (platform, passphrase, options) =>
    (await import("./backup-bundle.ts")).createBackup(platform, passphrase, passphrase, options),
  folderTarget,
  isAuthError: (error) => error instanceof DriveError && error.kind === "auth",
};

/** Runs the schedule once with the app's own folder, encryption and Drive errors (rules in `domain/run-schedule.ts`). */
export function runScheduledBackup(deps: {
  platform: BackupPlatform;
  folder: BackupFolder | undefined;
  /** The Drive target, when the app can sign in; null or absent when it cannot. */
  drive?: BackupTarget | null;
  schedule: BackupSchedule;
  passphrase: string | null;
  now: number;
  options?: BackupOptions;
}): Promise<RunReport> {
  return runDueBackup(deps, PORTS);
}
