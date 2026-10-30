import { describe, expect, test } from "bun:test";
import { type SecretMeta, Vault } from "../src/lib/vault.ts";

/** The OS keyring and the app's storage, both in memory: the real keyring is never touched. */
function fakePlatform() {
  const keyring = new Map<string, string>();
  const storage = new Map<string, string>();
  return {
    keyring,
    storage,
    platform: {
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
      vault: {
        get: async (id: string) => keyring.get(id) ?? null,
        set: async (id: string, value: string) => {
          keyring.set(id, value);
        },
        delete: async (id: string) => {
          keyring.delete(id);
        },
        generateKey: async () => ({ privateKey: "", publicKey: "" }),
        pickFile: async () => null,
        removeFile: async () => {},
      },
    },
  };
}

const VALUE = "hunter2-vault-test-value";

function newVault(clock = () => 1_000) {
  const fake = fakePlatform();
  let n = 0;
  const vault = new Vault(fake.platform, { clock, newId: () => `s${++n}` });
  return { ...fake, vault };
}

describe("cofre-armazenamento", () => {
  test("the value goes to the keyring under the secret id and the list holds metadata only", async () => {
    const { vault, keyring, storage } = newVault();
    const meta = await vault.create({
      name: "deploy",
      type: "password",
      value: VALUE,
      description: "prod",
      tags: ["prod"],
    });
    expect(meta).toEqual({
      id: "s1",
      name: "deploy",
      type: "password",
      description: "prod",
      tags: ["prod"],
      createdAt: 1_000,
      lastUsedAt: null,
      allowedHosts: ["local"],
    });
    expect(keyring.get("s1")).toBe(VALUE);
    expect(vault.list()).toEqual([meta]);
    expect(await vault.value("s1")).toBe(VALUE);
    for (const stored of storage.values()) expect(stored.includes(VALUE)).toBe(false);
  });

  test("the metadata survives a new Vault over the same storage, still without the value", async () => {
    const { vault, platform } = newVault();
    await vault.create({ name: "a", type: "token", value: VALUE, allowedHosts: ["h1"] });
    const again = new Vault(platform);
    expect(again.list().map((s) => [s.id, s.name, s.allowedHosts])).toEqual([["s1", "a", ["h1"]]]);
    expect(await again.value("s1")).toBe(VALUE);
  });

  test("removing a secret deletes it from the keyring and from the list", async () => {
    const { vault, keyring } = newVault();
    await vault.create({ name: "a", type: "password", value: VALUE });
    const second = await vault.create({ name: "b", type: "password", value: "other-test-value" });
    await vault.remove("s1");
    expect(keyring.has("s1")).toBe(false);
    expect(vault.list()).toEqual([second]);
    expect(await vault.value("s1")).toBeNull();
  });

  test("update changes the name, description, tags and allowed hosts and nothing else, and keeps the value", async () => {
    const { vault, keyring } = newVault();
    const meta = await vault.create({ name: "deploy", type: "password", value: VALUE });
    const updated = vault.update(meta.id, {
      name: "deploy prod",
      description: "the prod box",
      tags: ["prod"],
      allowedHosts: ["h1", "h2"],
    });
    expect(updated).toEqual({
      ...meta,
      name: "deploy prod",
      description: "the prod box",
      tags: ["prod"],
      allowedHosts: ["h1", "h2"],
    });
    expect(vault.list()).toEqual([updated as SecretMeta]);
    expect(keyring.get(meta.id)).toBe(VALUE);
  });

  test("update with a subset leaves the other fields, and an unknown id changes nothing", async () => {
    const { vault } = newVault();
    const meta = await vault.create({ name: "deploy", type: "token", value: VALUE, tags: ["a"] });
    expect(vault.update(meta.id, { description: "only this" })).toEqual({
      ...meta,
      description: "only this",
    });
    expect(vault.update("missing", { name: "x" })).toBeNull();
    expect(vault.list()).toHaveLength(1);
  });
});
