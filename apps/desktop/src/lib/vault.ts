import type { Platform } from "../platform/types.ts";

export type SecretType = "ssh-key" | "password" | "token" | "env";

/** What the vault knows about a secret besides its value; never the value itself. */
export interface SecretMeta {
  id: string;
  name: string;
  type: SecretType;
  description: string;
  tags: string[];
  createdAt: number;
  lastUsedAt: number | null;
  /** The hosts the secret may be delivered to; the local host only by default. */
  allowedHosts: string[];
}

export interface NewSecret {
  name: string;
  type: SecretType;
  value: string;
  description?: string;
  tags?: string[];
  allowedHosts?: string[];
}

/** The fields a generated or imported key takes besides its value. */
export type NewKey = Omit<NewSecret, "type" | "value">;

/** The fields of a secret that can be edited after it exists. */
export type SecretPatch = Partial<
  Pick<SecretMeta, "name" | "description" | "tags" | "allowedHosts">
>;

export interface VaultOptions {
  clock?: () => number;
  newId?: () => string;
}

const LIST_KEY = "flightdeck.vault";

/** Phase 16: the vault's list in `storage` and its values in the system keyring. */
export class Vault {
  constructor(
    private readonly platform: Pick<Platform, "storage" | "vault">,
    private readonly options: VaultOptions = {},
  ) {}

  list(): SecretMeta[] {
    const raw = this.platform.storage.getItem(LIST_KEY);
    return raw ? (JSON.parse(raw) as SecretMeta[]) : [];
  }

  private save(list: SecretMeta[]): void {
    this.platform.storage.setItem(LIST_KEY, JSON.stringify(list));
  }

  async create(input: NewSecret): Promise<SecretMeta> {
    const meta: SecretMeta = {
      id: (this.options.newId ?? (() => crypto.randomUUID()))(),
      name: input.name,
      type: input.type,
      description: input.description ?? "",
      tags: input.tags ?? [],
      createdAt: (this.options.clock ?? Date.now)(),
      lastUsedAt: null,
      allowedHosts: input.allowedHosts ?? ["local"],
    };
    // The value first: a list entry never points at a value that was not stored.
    await this.platform.vault.set(meta.id, input.value);
    this.save([...this.list(), meta]);
    return meta;
  }

  /** `ssh-keygen` makes the pair; the private key goes to the vault and the public one comes back. */
  async generateSshKey(input: NewKey): Promise<{ meta: SecretMeta; publicKey: string }> {
    const { privateKey, publicKey } = await this.platform.vault.generateKey(input.name);
    const meta = await this.create({ ...input, type: "ssh-key", value: privateKey });
    return { meta, publicKey };
  }

  /** The original is deleted only on request, and only after the value is in the vault. */
  async importKeyFile(input: NewKey & { deleteOriginal?: boolean }): Promise<SecretMeta | null> {
    const file = await this.platform.vault.pickFile();
    if (!file) return null;
    const { deleteOriginal, ...fields } = input;
    const meta = await this.create({ ...fields, type: "ssh-key", value: file.text });
    if (deleteOriginal) await this.platform.vault.removeFile(file.path);
    return meta;
  }

  /** Puts a secret back with its own id and metadata, replacing the one with that id. */
  async restore(meta: SecretMeta, value: string): Promise<void> {
    await this.platform.vault.set(meta.id, value);
    this.save([...this.list().filter((s) => s.id !== meta.id), meta]);
  }

  value(id: string): Promise<string | null> {
    return this.platform.vault.get(id);
  }

  /** Changes what the person may edit; the id, type, creation time and value never change. */
  update(_id: string, _patch: SecretPatch): SecretMeta | null {
    return null;
  }

  async remove(id: string): Promise<void> {
    this.save(this.list().filter((s) => s.id !== id));
    await this.platform.vault.delete(id);
  }
}
