import type { SecretMeta, Vault } from "./vault.ts";

export const MIN_PASSPHRASE = 12;

export type BackupErrorCode = "short-passphrase" | "mismatch" | "unreadable";

/** Why a backup was not written or not read. */
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(code);
  }
}

export interface BackupOptions {
  /** scrypt work factor (log2 N); tests lower it to stay fast. */
  workFactor?: number;
}

/** A secret of a backup: its metadata and its value. */
export interface BackupEntry {
  meta: SecretMeta;
  value: string;
}

/** What an import would do, by secret id. */
export interface ImportPreview {
  added: BackupEntry[];
  same: BackupEntry[];
  conflicting: BackupEntry[];
}

export type ConflictChoice = "skip" | "overwrite";

export interface ImportResult {
  added: number;
  overwritten: number;
  skipped: number;
}

/** Phase 16: the `.fdvault` file; `age` with a passphrase holds the metadata and the values. */
export async function exportVault(
  _vault: Vault,
  _passphrase: string,
  _confirmation: string,
  _options: BackupOptions = {},
): Promise<Uint8Array> {
  return new Uint8Array(0);
}

/** Reads a `.fdvault` and compares it with the vault; changes nothing. */
export async function previewImport(
  _vault: Vault,
  _file: Uint8Array,
  _passphrase: string,
): Promise<ImportPreview> {
  return { added: [], same: [], conflicting: [] };
}

/** Applies a preview: the new secrets are added, and each conflict is skipped or overwritten. */
export async function applyImport(
  _vault: Vault,
  _preview: ImportPreview,
  _onConflict: ConflictChoice = "skip",
): Promise<ImportResult> {
  return { added: -1, overwritten: -1, skipped: -1 };
}
