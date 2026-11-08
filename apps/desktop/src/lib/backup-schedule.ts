import type { BackupOptions, BackupPlatform } from "./backup-bundle.ts";

/** Issue #1264: scheduled backups to a picked folder, keeping the last N files. */
export const SCHEDULE_KEY = "flightdeck.backupSchedule";
export const DEFAULT_KEEP = 5;

export type Cadence = "off" | "daily" | "weekly";

export interface BackupSchedule {
  cadence: Cadence;
  folder: string;
  keep: number;
  lastRunAt: number | null;
}

/** The folder of backups, as the Rust shell offers it: only files named like a backup. */
export interface BackupFolder {
  write(dir: string, name: string, text: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  remove(dir: string, name: string): Promise<void>;
}

export type SkipReason = "no-folder" | "no-passphrase" | "failed";

export type RunReport =
  | { status: "done"; name: string; kept: number; removed: number; at: number }
  | { status: "skipped"; reason: SkipReason; at: number }
  | { status: "idle" };

export function loadSchedule(_storage: BackupPlatform["storage"]): BackupSchedule {
  return { cadence: "daily", folder: "", keep: 0, lastRunAt: 0 };
}

export function saveSchedule(
  _storage: BackupPlatform["storage"],
  _schedule: BackupSchedule,
): void {}

export function isDue(_schedule: BackupSchedule, _now: number): boolean {
  return false;
}

export function backupFileName(_now: number): string {
  return "";
}

export async function runScheduledBackup(_deps: {
  platform: BackupPlatform;
  folder: BackupFolder | undefined;
  schedule: BackupSchedule;
  passphrase: string | null;
  now: number;
  options?: BackupOptions;
}): Promise<RunReport> {
  return { status: "idle" };
}
