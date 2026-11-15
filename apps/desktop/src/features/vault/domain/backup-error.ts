export type BackupErrorCode = "short-passphrase" | "mismatch" | "unreadable";

/**
 * Why a backup was not written or not read. Its own module: the store catches it, and importing
 * it from `vault-backup.ts` would load `age` (and its crypto) with the app instead of on use.
 */
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(code);
  }
}
