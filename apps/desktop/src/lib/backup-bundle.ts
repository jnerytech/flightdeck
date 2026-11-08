import type { Platform } from "../platform/types.ts";
import type { ConflictChoice } from "./vault-backup.ts";

/** What a backup reads and writes: the app's settings, the host tokens and the vault. */
export type BackupPlatform = Pick<Platform, "storage" | "secrets" | "vault">;

export interface BackupOptions {
  /** scrypt work factor (log2 N); tests lower it to stay fast. */
  workFactor?: number;
  clock?: () => number;
}

/** What a restore would do with one kind of data, by name; never a value. */
export interface KindSummary {
  added: string[];
  same: string[];
  conflicting: string[];
}

export interface RestorePreview {
  createdAt: string;
  settings: KindSummary;
  personas: KindSummary;
  snippets: KindSummary;
  hosts: KindSummary;
  vault: KindSummary;
}

export interface RestoreResult {
  added: number;
  overwritten: number;
  skipped: number;
}

/** Issue #1241: the whole backup as the armored text of one encrypted file. */
export async function createBackup(
  _platform: BackupPlatform,
  _passphrase: string,
  _confirmation: string,
  _options: BackupOptions = {},
): Promise<string> {
  return "";
}

/** Reads a backup and compares it with this profile; changes nothing. */
export async function previewRestore(
  _platform: BackupPlatform,
  _text: string,
  _passphrase: string,
): Promise<RestorePreview> {
  const none = (): KindSummary => ({ added: [], same: [], conflicting: [] });
  return {
    createdAt: "",
    settings: none(),
    personas: none(),
    snippets: none(),
    hosts: none(),
    vault: none(),
  };
}

/** Applies a preview all or nothing: any failure puts the profile back as it was. */
export async function applyRestore(
  _platform: BackupPlatform,
  _preview: RestorePreview,
  _onConflict: ConflictChoice = "skip",
): Promise<RestoreResult> {
  return { added: 0, overwritten: 0, skipped: 0 };
}
