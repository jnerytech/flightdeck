import { describe, expect, test } from "bun:test";
import { Encrypter } from "age-encryption";
import { Vault } from "../../src/features/vault/vault.ts";
import { previewImport } from "../../src/features/vault/vault-backup.ts";
import { VaultRules } from "../../src/features/vault/vault-rules.ts";
import { VaultUsageLog } from "../../src/features/vault/vault-usage.ts";

/** The app's storage in memory, holding what a test plants. */
function storageWith(entries: Record<string, string>) {
  const items = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

const META = {
  id: "s1",
  name: "deploy",
  type: "token" as const,
  description: "",
  tags: ["prod"],
  createdAt: 1,
  lastUsedAt: null,
  allowedHosts: ["local"],
};

function vaultOver(storage: ReturnType<typeof storageWith>) {
  return new Vault({ storage, vault: {} as never });
}

describe("the vault's stored values are parsed, not trusted (#1609)", () => {
  test("a list entry that is not a secret is left out and the others stay", () => {
    const storage = storageWith({
      "flightdeck.vault": JSON.stringify([META, "junk", { id: 7 }, { ...META, type: "bogus" }]),
    });
    expect(vaultOver(storage).list()).toEqual([META]);
  });

  test("a list that is not an array, or not JSON, is an empty vault", () => {
    for (const raw of ['{"id":"s1"}', "not json", "null"]) {
      const vault = vaultOver(storageWith({ "flightdeck.vault": raw }));
      expect(() => vault.list()).not.toThrow();
      expect(vault.list()).toEqual([]);
    }
  });

  test("rules that are not a list are left out, a secret's own rules stay", () => {
    const rules = new VaultRules(
      storageWith({ "flightdeck.vaultRules": '{"a":"oops","b":[{"allow":true}],"c":null}' }),
    );
    expect(rules.all()).toEqual({ b: [{ allow: true }] });
    expect(rules.get("a")).toEqual([]);
  });

  test("rules that are not JSON, or not an object, are none", () => {
    for (const raw of ["not json", "[1,2]", '"x"']) {
      const rules = new VaultRules(storageWith({ "flightdeck.vaultRules": raw }));
      expect(() => rules.all()).not.toThrow();
      expect(rules.all()).toEqual({});
    }
  });

  test("a secret whose tags are not a list is left out, never given no tags", () => {
    const vault = vaultOver(
      storageWith({
        "flightdeck.vault": JSON.stringify([META, { ...META, id: "s2", tags: "prod" }]),
      }),
    );
    expect(vault.list()).toEqual([META]);
  });

  test("a secret missing its description, createdAt or lastUsedAt reads with the defaults", () => {
    const { id, name, type, tags, allowedHosts } = META;
    const bare = { id, name, type, tags, allowedHosts };
    const vault = vaultOver(storageWith({ "flightdeck.vault": JSON.stringify([bare]) }));
    expect(vault.list()).toEqual([{ ...META, description: "", createdAt: 0, lastUsedAt: null }]);
  });

  test("a write over a damaged list keeps the damaged text aside before it replaces it", async () => {
    const damaged = JSON.stringify([META, { ...META, id: "s2", type: "kerberos" }]);
    const storage = storageWith({ "flightdeck.vault": damaged });
    const vault = new Vault(
      { storage, vault: { set: async () => {} } as never },
      { clock: () => 5, newId: () => "s3" },
    );
    await vault.create({ name: "new", type: "token", value: "v" });
    expect(storage.getItem("flightdeck.vault.aside")).toBe(damaged);
    expect(vault.list().map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  test("a write over a healthy list keeps nothing aside", async () => {
    const storage = storageWith({ "flightdeck.vault": JSON.stringify([META]) });
    const vault = new Vault(
      { storage, vault: { set: async () => {} } as never },
      { clock: () => 5, newId: () => "s3" },
    );
    await vault.create({ name: "new", type: "token", value: "v" });
    expect(storage.getItem("flightdeck.vault.aside")).toBeNull();
  });

  test("a usage report with a date that is not a date is logged at the time it arrived", () => {
    const log = new VaultUsageLog({ storage: storageWith({}) }, { clock: () => 42 });
    log.recordUsed("h1", {
      type: "vault.used",
      secretId: "s1",
      purpose: "ssh",
      requester: "claude",
      action: "ssh box",
      at: "garbage",
    });
    expect(log.list().map((e) => e.at)).toEqual([42]);
  });

  test("a backup of another version, or whose body is not JSON, is unreadable", async () => {
    for (const body of [JSON.stringify({ version: 2, secrets: [] }), "not json at all"]) {
      const encrypter = new Encrypter();
      encrypter.setPassphrase("correct horse battery");
      encrypter.setScryptWorkFactor(4);
      const file = await encrypter.encrypt(body);
      await expect(
        previewImport(vaultOver(storageWith({})), file, "correct horse battery"),
      ).rejects.toMatchObject({ code: "unreadable" });
    }
  });

  test("saving a secret's rules over a damaged store keeps the good ones and drops the rest", () => {
    const rules = new VaultRules(
      storageWith({ "flightdeck.vaultRules": '{"a":"oops","b":[{"allow":true}]}' }),
    );
    rules.set("c", [{ allow: false }]);
    expect(rules.all()).toEqual({ b: [{ allow: true }], c: [{ allow: false }] });
  });

  const LINE = {
    secretId: "s1",
    hostId: "h1",
    purpose: "ssh",
    requester: "claude",
    at: 5,
    kind: "delivered" as const,
    detail: "",
  };

  test("a usage line that is not a line is left out and the others stay", () => {
    const log = new VaultUsageLog({
      storage: storageWith({
        "flightdeck.vault-usage": JSON.stringify([
          LINE,
          "junk",
          { secretId: 1 },
          { ...LINE, kind: "x" },
        ]),
      }),
    });
    expect(log.list()).toEqual([LINE]);
  });

  test("a usage log that is not an array does not stop the next line from being kept", () => {
    const storage = storageWith({ "flightdeck.vault-usage": '{"a":1}' });
    const log = new VaultUsageLog({ storage }, { clock: () => 9 });
    expect(() =>
      log.recordOutcome({
        hostId: "h1",
        secretId: "s1",
        purpose: "ssh",
        requester: "claude",
        delivered: true,
        reason: "",
      }),
    ).not.toThrow();
    expect(log.list().map((e) => e.at)).toEqual([9]);
  });

  test("a backup whose secret has a metadata of the wrong shape is refused as unreadable", async () => {
    const encrypter = new Encrypter();
    encrypter.setPassphrase("correct horse battery");
    encrypter.setScryptWorkFactor(4);
    const body = {
      version: 1,
      secrets: [{ value: "v", meta: { ...META, type: "bogus", tags: "not-a-list" } }],
    };
    const file = await encrypter.encrypt(JSON.stringify(body));
    const target = vaultOver(storageWith({}));
    await expect(previewImport(target, file, "correct horse battery")).rejects.toMatchObject({
      code: "unreadable",
    });
  });
});
