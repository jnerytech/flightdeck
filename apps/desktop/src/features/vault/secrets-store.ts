import { BackupError, type BackupErrorCode } from "../../lib/backup-error.ts";
import type { NewKey, NewSecret, SecretMeta, SecretPatch, Vault } from "./vault.ts";
import type { ConflictChoice, ImportPreview, ImportResult } from "./vault-backup.ts";

/** Why a `.fdvault` export or import did not go through: the backup's own code, or a cancelled dialog. */
export type VaultFileFailure = { ok: false; code: BackupErrorCode | "cancelled" };

/** What the secrets read and ask through the app's store. */
export interface VaultSecretsCore {
  vault: Vault;
  /** Tells the screens that read the secrets to read them again. */
  secretsChanged(): void;
  /** The cost of the key derivation of a `.fdvault`; the default one when unset (tests lower it). */
  workFactor(): number | undefined;
  /** Saves a file the person names; false when the dialog is cancelled. */
  saveFile(name: string, text: string): Promise<boolean>;
  /** A file the person picks; null when the dialog is cancelled. */
  pickFile(): Promise<{ text: string } | null>;
  /** A failure for the person to read. */
  fail(error: unknown): void;
}

/**
 * The secrets of the vault (phase 16; #1596: a slice of the store): created, generated, imported
 * from a key file, edited and removed, and the encrypted `.fdvault` file that carries them between
 * machines. Values never come back from here, only metadata; an error never carries a value.
 */
export class VaultSecretsSlice {
  constructor(private readonly core: VaultSecretsCore) {}

  async add(input: NewSecret): Promise<SecretMeta> {
    const meta = await this.core.vault.create(input);
    this.core.secretsChanged();
    return meta;
  }

  /** `ssh-keygen` makes a pair; the private key goes to the vault, the public one comes back. */
  async generateKey(input: NewKey): Promise<{ meta: SecretMeta; publicKey: string } | null> {
    try {
      const made = await this.core.vault.generateSshKey(input);
      this.core.secretsChanged();
      return made;
    } catch (error) {
      this.core.fail(error);
      return null;
    }
  }

  /** Stores a key file the person picks; null when the dialog is cancelled or it fails. */
  async importKeyFile(input: NewKey & { deleteOriginal?: boolean }): Promise<SecretMeta | null> {
    try {
      const meta = await this.core.vault.importKeyFile(input);
      this.core.secretsChanged();
      return meta;
    } catch (error) {
      this.core.fail(error);
      return null;
    }
  }

  /** Edits a secret's name, description, tags and allowed hosts; its value is not touched. */
  update(id: string, patch: SecretPatch): SecretMeta | null {
    const meta = this.core.vault.update(id, patch);
    this.core.secretsChanged();
    return meta;
  }

  async remove(id: string): Promise<void> {
    await this.core.vault.remove(id);
    this.core.secretsChanged();
  }

  /** Saves the vault as an encrypted `cofre.fdvault`; the reason when it is refused or cancelled. */
  async exportFile(
    passphrase: string,
    confirmation: string,
  ): Promise<{ ok: true } | VaultFileFailure> {
    try {
      const { exportVault, toFdvault } = await import("./vault-backup.ts");
      const workFactor = this.core.workFactor();
      const file = await exportVault(this.core.vault, passphrase, confirmation, {
        ...(workFactor !== undefined && { workFactor }),
      });
      const saved = await this.core.saveFile("cofre.fdvault", toFdvault(file));
      return saved ? { ok: true } : { ok: false, code: "cancelled" };
    } catch (error) {
      return this.refused(error);
    }
  }

  /** Reads a `.fdvault` the person picks and compares it with the vault; changes nothing. */
  async previewImport(
    passphrase: string,
  ): Promise<{ ok: true; preview: ImportPreview } | VaultFileFailure> {
    try {
      const file = await this.core.pickFile();
      if (!file) return { ok: false, code: "cancelled" };
      const { fromFdvault, previewImport } = await import("./vault-backup.ts");
      const preview = await previewImport(this.core.vault, fromFdvault(file.text), passphrase);
      return { ok: true, preview };
    } catch (error) {
      return this.refused(error);
    }
  }

  async applyImport(preview: ImportPreview, onConflict: ConflictChoice): Promise<ImportResult> {
    const { applyImport } = await import("./vault-backup.ts");
    const result = await applyImport(this.core.vault, preview, onConflict);
    this.core.secretsChanged();
    return result;
  }

  /** A backup's own refusal is a code for the screen; anything else is an error to show. */
  private refused(error: unknown): VaultFileFailure {
    if (error instanceof BackupError) return { ok: false, code: error.code };
    this.core.fail(error);
    return { ok: false, code: "cancelled" };
  }
}
