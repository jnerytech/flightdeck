import { Decrypter, Encrypter } from "age-encryption";
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

const VERSION = 1;
const DEFAULT_WORK_FACTOR = 18;

/** Phase 16: the `.fdvault` file; `age` with a passphrase holds the metadata and the values. */
export async function exportVault(
  vault: Vault,
  passphrase: string,
  confirmation: string,
  options: BackupOptions = {},
): Promise<Uint8Array> {
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupError("short-passphrase");
  if (passphrase !== confirmation) throw new BackupError("mismatch");
  const entries: BackupEntry[] = [];
  for (const meta of vault.list()) {
    const value = await vault.value(meta.id);
    if (value !== null) entries.push({ meta, value });
  }
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(options.workFactor ?? DEFAULT_WORK_FACTOR);
  return encrypter.encrypt(JSON.stringify({ version: VERSION, secrets: entries }));
}

function isEntry(item: unknown): item is BackupEntry {
  const entry = item as BackupEntry | null;
  return (
    typeof entry?.value === "string" &&
    typeof entry.meta?.id === "string" &&
    typeof entry.meta.name === "string" &&
    Array.isArray(entry.meta.allowedHosts)
  );
}

async function readBackup(file: Uint8Array, passphrase: string): Promise<BackupEntry[]> {
  try {
    const decrypter = new Decrypter();
    decrypter.addPassphrase(passphrase);
    const body = JSON.parse(await decrypter.decrypt(file, "text")) as {
      version: number;
      secrets: unknown[];
    };
    if (body.version !== VERSION || !body.secrets.every(isEntry)) throw new Error("shape");
    return body.secrets as BackupEntry[];
  } catch {
    // A wrong passphrase, a tampered file and a file that is no backup look the same, on purpose.
    throw new BackupError("unreadable");
  }
}

function sameSecret(a: BackupEntry, b: BackupEntry): boolean {
  return (
    a.value === b.value &&
    a.meta.name === b.meta.name &&
    a.meta.type === b.meta.type &&
    a.meta.description === b.meta.description &&
    JSON.stringify(a.meta.tags) === JSON.stringify(b.meta.tags) &&
    JSON.stringify(a.meta.allowedHosts) === JSON.stringify(b.meta.allowedHosts)
  );
}

/** Reads a `.fdvault` and compares it with the vault; changes nothing. */
export async function previewImport(
  vault: Vault,
  file: Uint8Array,
  passphrase: string,
): Promise<ImportPreview> {
  const preview: ImportPreview = { added: [], same: [], conflicting: [] };
  const local = vault.list();
  for (const entry of await readBackup(file, passphrase)) {
    const meta = local.find((s) => s.id === entry.meta.id);
    if (!meta) {
      preview.added.push(entry);
      continue;
    }
    const current: BackupEntry = { meta, value: (await vault.value(meta.id)) ?? "" };
    (sameSecret(current, entry) ? preview.same : preview.conflicting).push(entry);
  }
  return preview;
}

/** Applies a preview: the new secrets are added, and each conflict is skipped or overwritten. */
export async function applyImport(
  vault: Vault,
  preview: ImportPreview,
  onConflict: ConflictChoice = "skip",
): Promise<ImportResult> {
  for (const entry of preview.added) await vault.restore(entry.meta, entry.value);
  if (onConflict === "overwrite") {
    for (const entry of preview.conflicting) await vault.restore(entry.meta, entry.value);
  }
  return {
    added: preview.added.length,
    overwritten: onConflict === "overwrite" ? preview.conflicting.length : 0,
    skipped: onConflict === "skip" ? preview.conflicting.length : 0,
  };
}
