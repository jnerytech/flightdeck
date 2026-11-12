import { describe, expect, test } from "bun:test";
import { type VaultSecretsCore, VaultSecretsSlice } from "../../src/features/vault/index.ts";
import type { SecretMeta } from "../../src/features/vault/vault.ts";

const META = {
  id: "s1",
  name: "deploy",
  tags: [],
  allowedHosts: ["local"],
} as unknown as SecretMeta;
const PASS = "a long enough passphrase";

/**
 * A slice over stand-ins: `vault` answers or fails as `over.vault` says, and every effect the
 * slice has on the rest of the app is written down in `events`.
 */
function slice(
  over: {
    vault?: Record<string, unknown>;
    save?: boolean;
    picked?: { text: string } | null;
    pickFails?: boolean;
    workFactor?: number;
  } = {},
) {
  const events: string[] = [];
  const saved: Array<{ name: string; text: string }> = [];
  const vault = {
    create: async () => META,
    list: () => [META],
    value: async () => "the-value",
    update: () => META,
    remove: async () => {},
    ...over.vault,
  };
  const core: VaultSecretsCore = {
    vault: vault as unknown as VaultSecretsCore["vault"],
    secretsChanged: () => {
      events.push("changed");
    },
    workFactor: () => over.workFactor ?? 4,
    saveFile: async (name, text) => {
      saved.push({ name, text });
      return over.save ?? true;
    },
    pickFile: async () => {
      if (over.pickFails) throw new Error("the dialog broke");
      return over.picked === undefined ? null : over.picked;
    },
    fail: (error) => {
      events.push(`fail ${(error as Error).message}`);
    },
  };
  return { secrets: new VaultSecretsSlice(core), events, saved };
}

describe("vault secrets slice", () => {
  test("a secret added, edited or removed tells the screens once, and its metadata comes back", async () => {
    const { secrets, events } = slice();
    expect(await secrets.add({ name: "deploy", type: "token", value: "v" })).toBe(META);
    expect(secrets.update("s1", { name: "deploy 2" })).toBe(META);
    await secrets.remove("s1");
    expect(events).toEqual(["changed", "changed", "changed"]);
  });

  test("a key that cannot be generated or imported is a failure to show, not a stored secret", async () => {
    const broken = {
      generateSshKey: async () => {
        throw new Error("no ssh-keygen");
      },
      importKeyFile: async () => {
        throw new Error("no file");
      },
    };
    const { secrets, events } = slice({ vault: broken });
    expect(await secrets.generateKey({ name: "deploy" })).toBeNull();
    expect(await secrets.importKeyFile({ name: "deploy" })).toBeNull();
    expect(events).toEqual(["fail no ssh-keygen", "fail no file"]);
  });

  test("a generated key comes back with its public half and tells the screens", async () => {
    const made = { meta: META, publicKey: "ssh-ed25519 AAAA" };
    const { secrets, events } = slice({ vault: { generateSshKey: async () => made } });
    expect(await secrets.generateKey({ name: "deploy" })).toBe(made);
    expect(events).toEqual(["changed"]);
  });

  test("an export saves one encrypted cofre.fdvault, and a cancelled dialog saves nothing", async () => {
    const done = slice();
    expect(await done.secrets.exportFile(PASS, PASS)).toEqual({ ok: true });
    expect(done.saved.map((f) => f.name)).toEqual(["cofre.fdvault"]);
    expect(done.saved[0]?.text).not.toContain("the-value");
    const cancelled = slice({ save: false });
    expect(await cancelled.secrets.exportFile(PASS, PASS)).toEqual({
      ok: false,
      code: "cancelled",
    });
  });

  test("a refused passphrase is a code for the screen, with no save and no failure notice", async () => {
    const { secrets, events, saved } = slice();
    expect(await secrets.exportFile("short", "short")).toEqual({
      ok: false,
      code: "short-passphrase",
    });
    expect(await secrets.exportFile(PASS, `${PASS}x`)).toEqual({ ok: false, code: "mismatch" });
    expect(saved).toEqual([]);
    expect(events).toEqual([]);
  });

  test("a preview of a cancelled dialog is cancelled, and a broken dialog is a failure to show", async () => {
    expect(await slice().secrets.previewImport(PASS)).toEqual({ ok: false, code: "cancelled" });
    const broken = slice({ pickFails: true });
    expect(await broken.secrets.previewImport(PASS)).toEqual({ ok: false, code: "cancelled" });
    expect(broken.events).toEqual(["fail the dialog broke"]);
  });

  test("a file that is not a backup is refused with the backup's own code, not as a failure", async () => {
    const { secrets, events } = slice({ picked: { text: "not a backup at all" } });
    expect(await secrets.previewImport(PASS)).toEqual({ ok: false, code: "unreadable" });
    expect(events).toEqual([]);
  });

  test("applying an import restores what the backup adds and tells the screens", async () => {
    const restored: string[] = [];
    const { secrets, events } = slice({
      vault: { restore: async (meta: SecretMeta) => void restored.push(meta.id) },
    });
    const preview = { added: [{ meta: META, value: "v" }], same: [], conflicting: [] };
    expect(await secrets.applyImport(preview, "skip")).toEqual({
      added: 1,
      overwritten: 0,
      skipped: 0,
    });
    expect(restored).toEqual(["s1"]);
    expect(events).toEqual(["changed"]);
  });
});
