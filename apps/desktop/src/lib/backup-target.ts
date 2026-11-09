import type { Platform } from "../platform/types.ts";

/** Issue #1444: where a backup goes. The folder of #1264 and Google Drive both implement it. */
export interface BackupTarget {
  /** Stores `text` (the already-encrypted bundle) under `name`, replacing a file of that name. */
  put(name: string, text: string): Promise<void>;
  /** The names of the backups held, in no particular order. */
  list(): Promise<string[]>;
  /** The text of the backup called `name`. */
  get(name: string): Promise<string>;
  remove(name: string): Promise<void>;
}

/** The folder of backups, as the Rust shell offers it: only files named like a backup. */
export type BackupFolder = NonNullable<Platform["backupFolder"]>;

/** `flightdeck-backup-YYYYMMDD-HHMMSS.fdbackup`: the UTC time, so names sort by age. */
export const BACKUP_NAME = /^flightdeck-backup-\d{8}-\d{6}\.fdbackup$/;

export type KeptReport =
  | { ok: true; kept: number; removed: number }
  | { ok: false; removed: number };

export function folderTarget(_folder: BackupFolder): BackupTarget {
  return {
    put: async () => {},
    list: async () => [],
    get: async () => "",
    remove: async () => {},
  };
}

export async function keepNewest(
  _target: BackupTarget,
  _keep: number,
  _protect: string,
): Promise<KeptReport> {
  return { ok: true, kept: 0, removed: 0 };
}
