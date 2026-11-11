/**
 * The backup's public entry in the app (#1589, #1596): the whole-app backup file (save, read, compare
 * and restore), from a file or from Google Drive. Another domain imports from here, never a file inside.
 */
export {
  type BackupCore,
  type BackupOutcomeCode,
  type BackupPreviewOutcome,
  BackupSlice,
} from "./store.ts";
