import type { Platform } from "../../platform/types.ts";
import type { BackupTarget } from "./domain/backup-target.ts";

/** The folder of backups, as the Rust shell offers it: only files named like a backup. */
export type BackupFolder = NonNullable<Platform["backupFolder"]>;

export function folderTarget(folder: BackupFolder): BackupTarget {
  return {
    put: (name, text) => folder.write(name, text),
    list: () => folder.list(),
    // The Rust shell writes, lists and removes; reading a file back is not one of its commands.
    get: () => Promise.reject(new Error("unsupported")),
    remove: (name) => folder.remove(name),
  };
}
