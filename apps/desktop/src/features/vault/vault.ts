import { z } from "zod";
import { readStored, validItems } from "@/shared/lib/index.ts";
import type { Platform } from "../../platform/types.ts";
import { describeSecret, type SecretInfo, type SecretType } from "./vault-types.ts";

export type { SecretType };

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

/** What a stored or imported secret must look like: identity, tags and hosts are required (they decide who may use it), the rest has a default. */
export const SecretMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["ssh-key", "password", "token", "env"]),
  description: z.string().catch(""),
  tags: z.array(z.string()),
  createdAt: z.number().catch(0),
  lastUsedAt: z.number().nullable().catch(null),
  allowedHosts: z.array(z.string()),
});

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
/** Where the text of a list that held damaged entries waits when a write replaces it (#1609). */
const ASIDE_KEY = "flightdeck.vault.aside";

/** Phase 16: the vault's list in `storage` and its values in the system keyring. */
export class Vault {
  constructor(
    private readonly platform: Pick<Platform, "storage" | "vault">,
    private readonly options: VaultOptions = {},
  ) {}

  /** What a row shows about each secret, derived once per id and held in memory only (#2612). */
  private readonly infos = new Map<string, Promise<SecretInfo>>();

  /**
   * What a row may show about a secret (public key, fingerprint, hint, variable names), never the
   * value. A value is read once, and only for a type that has something to derive; the answer is
   * kept in memory until the secret changes, `forgetInfos` runs or the app closes. Nothing is stored.
   */
  info(meta: SecretMeta): Promise<SecretInfo> {
    if (meta.type === "password") return Promise.resolve({});
    const known = this.infos.get(meta.id);
    if (known) return known;
    const derived = this.value(meta.id).then((value) =>
      value === null ? {} : describeSecret(meta.type, value),
    );
    this.infos.set(meta.id, derived);
    // A failed read is not remembered: the next list change tries again.
    derived.catch(() => {
      if (this.infos.get(meta.id) === derived) this.infos.delete(meta.id);
    });
    return derived;
  }

  /** Drops every derived row detail, for example when the vault screen closes. */
  forgetInfos(): void {
    this.infos.clear();
  }

  list(): SecretMeta[] {
    return readStored(this.platform.storage, LIST_KEY, validItems(SecretMetaSchema), []);
  }

  /** A write drops what `list` left out; keep that text aside once, so a damaged entry is never erased for good. */
  private keepDamagedAside(): void {
    const raw = this.platform.storage.getItem(LIST_KEY);
    if (raw === null) return;
    const stored = readStored(this.platform.storage, LIST_KEY, z.array(z.unknown()), null);
    if (stored?.length === this.list().length) return;
    this.platform.storage.setItem(ASIDE_KEY, raw);
  }

  private save(list: SecretMeta[]): void {
    this.keepDamagedAside();
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
    this.infos.delete(meta.id);
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
    this.infos.delete(meta.id);
    this.save([...this.list().filter((s) => s.id !== meta.id), meta]);
  }

  value(id: string): Promise<string | null> {
    return this.platform.vault.get(id);
  }

  /** Changes what the person may edit; the id, type, creation time and value never change. */
  update(id: string, patch: SecretPatch): SecretMeta | null {
    const list = this.list();
    const current = list.find((s) => s.id === id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.save(list.map((s) => (s.id === id ? next : s)));
    return next;
  }

  /** The value goes first: when the keyring refuses, the secret stays listed and can be removed again. */
  async remove(id: string): Promise<void> {
    await this.platform.vault.delete(id);
    this.infos.delete(id);
    this.save(this.list().filter((s) => s.id !== id));
  }
}
