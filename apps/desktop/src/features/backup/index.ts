/**
 * The backup's public entry in the app (#1589, #1596): the whole-app backup file (save, read, compare
 * and restore), from a file or from Google Drive. Another domain imports from here, never a file inside.
 */
export { BackupError, type BackupErrorCode } from "./backup-error.ts";
export { type Attention, BackupScheduler } from "./backup-scheduler.ts";
export { type BackupCore, BackupSlice } from "./store.ts";
