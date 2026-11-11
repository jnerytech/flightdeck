import type { RestorePreview, RestoreResult } from "../../lib/backup-bundle.ts";
import { BackupError, type BackupErrorCode } from "../../lib/backup-error.ts";
import { BACKUP_NAME } from "../../lib/backup-target.ts";
import { DriveError } from "../../lib/drive-target.ts";
import type { ConflictChoice } from "../../lib/vault-backup.ts";

/** What the restore picker reads at most (PICKED_FILE_MAX_BYTES in src-tauri/src/lib.rs, #1241). */
const BACKUP_FILE_MAX_BYTES = 1024 * 1024;

/** What a backup or a read says besides a BackupError code: a cancelled dialog, or any other failure. */
export type BackupOutcomeCode =
  | "cancelled"
  | "too-big"
  | "unexpected"
  | "drive-auth"
  | "drive-failed";

/** A Drive call that failed, as the restore tells it: the sign-in is gone, or Drive could not be read. */
function driveCode(error: unknown): "drive-auth" | "drive-failed" {
  return error instanceof DriveError && error.kind === "auth" ? "drive-auth" : "drive-failed";
}

/** What the whole-app backup reads and writes through the app's store. */
export interface BackupCore {
  /** The whole backup as armored text, encrypted with the passphrase; throws a BackupError when refused. */
  createText(passphrase: string, confirmation: string): Promise<string>;
  /** Saves a file the person names; false when they cancel. */
  saveFile(name: string, text: string): Promise<boolean>;
  /** A backup file the person picks; null when they cancel. */
  pickFile(): Promise<{ text: string } | null>;
  /** Reads a backup and compares it with this profile; changes nothing. */
  previewText(text: string, passphrase: string): Promise<RestorePreview>;
  /** Applies a preview all or nothing. */
  applyPreview(preview: RestorePreview, onConflict: ConflictChoice): Promise<RestoreResult>;
  /** The names of the backups on Google Drive. */
  driveNames(): Promise<string[]>;
  /** One backup of Google Drive, as text. */
  driveText(name: string): Promise<string>;
  /** Tells the person about a failure no code explains. */
  fail(error: unknown): void;
}

/** What a backup preview answers: the preview, or why it could not be read. */
export type BackupPreviewOutcome =
  | { ok: true; preview: RestorePreview }
  | { ok: false; code: BackupErrorCode | BackupOutcomeCode };

/** The whole-app backup: saved as one encrypted file, read back from a file or Google Drive, and restored (#1241, #1462; #1596: a slice of the store). */
export class BackupSlice {
  constructor(private readonly core: BackupCore) {}

  /** Issue #1241: saves the whole backup as one encrypted file; the reason when refused or cancelled. */
  async create(
    passphrase: string,
    confirmation: string,
  ): Promise<{ ok: true } | { ok: false; code: BackupErrorCode | BackupOutcomeCode }> {
    try {
      const text = await this.core.createText(passphrase, confirmation);
      // The armored text is ASCII, so its length is its size. A file the restore cannot pick again
      // is no backup: refuse it now, with the reason, instead of saving it.
      if (text.length > BACKUP_FILE_MAX_BYTES) return { ok: false, code: "too-big" };
      const saved = await this.core.saveFile("flightdeck-backup.fdbackup", text);
      return saved ? { ok: true } : { ok: false, code: "cancelled" };
    } catch (error) {
      return this.refused(error);
    }
  }

  /** Issue #1241: reads a backup file the person picks and compares it with this profile; changes nothing. */
  async preview(passphrase: string): Promise<BackupPreviewOutcome> {
    try {
      const file = await this.core.pickFile();
      if (!file) return { ok: false, code: "cancelled" };
      return { ok: true, preview: await this.core.previewText(file.text, passphrase) };
    } catch (error) {
      return this.refused(error);
    }
  }

  /** Issue #1462: the backups on Google Drive, newest first. */
  async driveList(): Promise<
    { ok: true; names: string[] } | { ok: false; code: "drive-auth" | "drive-failed" }
  > {
    try {
      const names = (await this.core.driveNames())
        .filter((name) => BACKUP_NAME.test(name))
        .sort((a, b) => b.localeCompare(a));
      return { ok: true, names };
    } catch (error) {
      return { ok: false, code: driveCode(error) };
    }
  }

  /** Issue #1462: reads one backup from Google Drive into the same preview as a file. */
  async previewDrive(name: string, passphrase: string): Promise<BackupPreviewOutcome> {
    let text: string;
    try {
      text = await this.core.driveText(name);
    } catch (error) {
      return { ok: false, code: driveCode(error) };
    }
    if (text.length > BACKUP_FILE_MAX_BYTES) return { ok: false, code: "too-big" };
    try {
      return { ok: true, preview: await this.core.previewText(text, passphrase) };
    } catch (error) {
      return this.refused(error);
    }
  }

  /**
   * Issue #1241: applies a preview all or nothing. The app reads the restored settings and hosts
   * when it starts again, so the person is told to reopen it.
   */
  async restore(
    preview: RestorePreview,
    onConflict: ConflictChoice,
  ): Promise<{ ok: true; result: RestoreResult } | { ok: false }> {
    try {
      return { ok: true, result: await this.core.applyPreview(preview, onConflict) };
    } catch (error) {
      // A restore that failed put everything back; a preview already used says it is unreadable.
      if (!(error instanceof BackupError)) this.core.fail(error);
      return { ok: false };
    }
  }

  /** A BackupError says its own code; anything else is told to the person and answered as unexpected. */
  private refused(error: unknown): { ok: false; code: BackupErrorCode | BackupOutcomeCode } {
    if (error instanceof BackupError) return { ok: false, code: error.code };
    this.core.fail(error);
    return { ok: false, code: "unexpected" };
  }
}
