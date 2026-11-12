import { inSequence } from "@flightdeck/protocol";
import type { Platform } from "../../platform/types.ts";

/** Issue #1444: where a backup goes. The folder of #1264 and Google Drive both implement it. */
export interface BackupTarget {
  /** Stores `text` (the already-encrypted bundle) under `name`. */
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

export function folderTarget(folder: BackupFolder): BackupTarget {
  return {
    put: (name, text) => folder.write(name, text),
    list: () => folder.list(),
    // The Rust shell writes, lists and removes; reading a file back is not one of its commands.
    get: () => Promise.reject(new Error("unsupported")),
    remove: (name) => folder.remove(name),
  };
}

/** Code-unit order: the names are dates, so the oldest sorts first. */
function compareNames(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Keeps the newest `keep` backups of the target, `protect` (the one just put) among them, and removes
 * the older ones one at a time. A name not shaped like a backup is never touched. A target that cannot
 * be read or cleaned reports `ok: false` with what was removed before it stopped.
 */
export async function keepNewest(
  target: BackupTarget,
  keep: number,
  protect: string,
): Promise<KeptReport> {
  let removed = 0;
  try {
    const others = (await target.list())
      .filter((one) => BACKUP_NAME.test(one) && one !== protect)
      .sort(compareNames);
    const stale = others.slice(0, Math.max(0, others.length - (keep - 1)));
    await inSequence(stale, async (old) => {
      await target.remove(old);
      removed += 1;
    });
    return { ok: true, kept: others.length - stale.length + 1, removed };
  } catch {
    return { ok: false, removed };
  }
}
