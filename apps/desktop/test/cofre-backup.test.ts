import { describe, expect, test } from "bun:test";
import { Vault } from "../src/lib/vault.ts";
import { applyImport, BackupError, exportVault, previewImport } from "../src/lib/vault-backup.ts";

/** The OS keyring and the app's storage, both in memory: the real keyring is never touched. */
function newVault(prefix: string) {
  const keyring = new Map<string, string>();
  const storage = new Map<string, string>();
  let n = 0;
  const vault = new Vault(
    {
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
    { clock: () => 1_000, newId: () => `${prefix}${++n}` },
  );
  return { vault, keyring };
}

const PASS = "correct horse battery";
const FAST = { workFactor: 4 };
const VALUE = "backup-test-value-654";

async function seeded() {
  const source = newVault("s");
  await source.vault.create({ name: "deploy", type: "token", value: VALUE, tags: ["prod"] });
  await source.vault.create({ name: "box", type: "password", value: "pw-two-backup" });
  return source;
}

describe("cofre-backup", () => {
  test("the file is encrypted: neither a value nor a name shows in it", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    expect(file.length).toBeGreaterThan(0);
    const text = new TextDecoder("latin1").decode(file);
    expect(text).not.toContain(VALUE);
    expect(text).not.toContain("deploy");
  });

  test("a passphrase under 12 characters is refused", async () => {
    const { vault } = await seeded();
    await expect(exportVault(vault, "short", "short", FAST)).rejects.toMatchObject({
      code: "short-passphrase",
    });
  });

  test("a confirmation that differs from the passphrase is refused", async () => {
    const { vault } = await seeded();
    await expect(exportVault(vault, PASS, `${PASS}x`, FAST)).rejects.toBeInstanceOf(BackupError);
    await expect(exportVault(vault, PASS, `${PASS}x`, FAST)).rejects.toMatchObject({
      code: "mismatch",
    });
  });

  test("an import into an empty vault previews every secret as new and restores values and metadata", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    const target = newVault("t");
    const preview = await previewImport(target.vault, file, PASS);
    expect(preview.added.map((e) => e.meta.name).sort()).toEqual(["box", "deploy"]);
    expect(preview.same).toEqual([]);
    expect(preview.conflicting).toEqual([]);
    const result = await applyImport(target.vault, preview);
    expect(result).toEqual({ added: 2, overwritten: 0, skipped: 0 });
    const deploy = target.vault.list().find((s) => s.name === "deploy");
    expect(deploy?.tags).toEqual(["prod"]);
    expect(deploy ? await target.vault.value(deploy.id) : null).toBe(VALUE);
  });

  test("previewing changes nothing", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    const target = newVault("t");
    await previewImport(target.vault, file, PASS);
    expect(target.vault.list()).toEqual([]);
    expect(target.keyring.size).toBe(0);
  });

  test("a secret that is already there, equal, previews as the same and is not touched", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    const preview = await previewImport(vault, file, PASS);
    expect(preview.same).toHaveLength(2);
    expect(preview.added).toEqual([]);
    expect(preview.conflicting).toEqual([]);
    expect(await applyImport(vault, preview)).toEqual({ added: 0, overwritten: 0, skipped: 0 });
  });

  test("a secret with the same id but another value previews as a conflict; skip keeps the local one and overwrite takes the backup's", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    const [first] = vault.list();
    if (!first) throw new Error("seed");
    await vault.restore({ ...first, name: "renamed" }, "changed-local-value");

    const preview = await previewImport(vault, file, PASS);
    expect(preview.conflicting.map((e) => e.meta.id)).toEqual([first.id]);
    expect(preview.same).toHaveLength(1);

    const skipped = await applyImport(vault, preview, "skip");
    expect(skipped).toEqual({ added: 0, overwritten: 0, skipped: 1 });
    expect(await vault.value(first.id)).toBe("changed-local-value");

    const overwritten = await applyImport(vault, preview, "overwrite");
    expect(overwritten).toEqual({ added: 0, overwritten: 1, skipped: 0 });
    expect(await vault.value(first.id)).toBe(VALUE);
    expect(vault.list().find((s) => s.id === first.id)?.name).toBe("deploy");
  });

  test("a wrong passphrase is refused as unreadable", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    await expect(
      previewImport(newVault("t").vault, file, "another passphrase"),
    ).rejects.toMatchObject({
      code: "unreadable",
    });
  });

  test("a tampered file is refused as unreadable and nothing is imported", async () => {
    const { vault } = await seeded();
    const file = await exportVault(vault, PASS, PASS, FAST);
    const tampered = file.slice();
    const at = tampered.length - 20;
    tampered[at] = (tampered[at] ?? 0) ^ 0xff;
    const target = newVault("t");
    await expect(previewImport(target.vault, tampered, PASS)).rejects.toMatchObject({
      code: "unreadable",
    });
    expect(target.vault.list()).toEqual([]);
  });

  test("a file that is not a backup is refused as unreadable", async () => {
    const target = newVault("t");
    await expect(
      previewImport(target.vault, new TextEncoder().encode("not a vault"), PASS),
    ).rejects.toMatchObject({ code: "unreadable" });
  });
});
