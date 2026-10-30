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

  value(id: string): Promise<string | null> {
    return this.platform.vault.get(id);
  }

  async remove(id: string): Promise<void> {
    this.save(this.list().filter((s) => s.id !== id));
    await this.platform.vault.delete(id);
  }
}
