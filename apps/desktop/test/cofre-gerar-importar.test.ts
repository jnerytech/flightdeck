import { describe, expect, test } from "bun:test";
import { Vault } from "../src/lib/vault.ts";
import { tauriPlatform } from "../src/platform/tauri/index.ts";
import { createWebPlatform } from "../src/platform/web/index.ts";

const KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-KEY-BODY\n-----END OPENSSH PRIVATE KEY-----\n";

/** A fake keyring, storage, ssh-keygen and file dialog: the real ones are never touched. */
function setup(
  picked: { path: string; text: string } | null = { path: "/home/a/id_x", text: KEY },
) {
  const keyring = new Map<string, string>();
  const storage = new Map<string, string>();
  const removed: string[] = [];
  const comments: string[] = [];
  const platform = {
    storage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    },
    vault: {
      get: async (id: string) => keyring.get(id) ?? null,
      set: async (id: string, v: string) => {
        keyring.set(id, v);
      },
      delete: async (id: string) => {
        keyring.delete(id);
      },
      generateKey: async (comment: string) => {
        comments.push(comment);
        return { privateKey: KEY, publicKey: "ssh-ed25519 AAAAPUBLIC deploy" };
      },
      pickFile: async () => picked,
      removeFile: async (path: string) => {
        removed.push(path);
      },
    },
  };
  let n = 0;
  const vault = new Vault(platform, { clock: () => 5, newId: () => `k${++n}` });
  return { vault, keyring, storage, removed, comments };
}

describe("cofre-gerar-importar", () => {
  test("generating a key stores the private key as an ssh-key and returns the public one, without keeping it in the list", async () => {
    const { vault, keyring, storage, comments } = setup();
    const { meta, publicKey } = await vault.generateSshKey({ name: "deploy", tags: ["prod"] });
    expect(publicKey).toBe("ssh-ed25519 AAAAPUBLIC deploy");
    expect(comments).toEqual(["deploy"]);
    expect(meta).toEqual({
      id: "k1",
      name: "deploy",
      type: "ssh-key",
      description: "",
      tags: ["prod"],
      createdAt: 5,
      lastUsedAt: null,
      allowedHosts: ["local"],
    });
    expect(keyring.get("k1")).toBe(KEY);
    expect(vault.list()).toEqual([meta]);
    for (const stored of storage.values()) expect(stored.includes("TEST-KEY-BODY")).toBe(false);
  });

  test("importing a key file stores its text as an ssh-key and keeps the original by default", async () => {
    const { vault, keyring, removed } = setup();
    const meta = await vault.importKeyFile({ name: "from disk" });
    expect(meta?.type).toBe("ssh-key");
    expect(meta?.name).toBe("from disk");
    expect(keyring.get("k1")).toBe(KEY);
    expect(removed).toEqual([]);
  });

  test("importing with deleteOriginal removes the picked file only after the value is stored", async () => {
    const { vault, keyring, removed } = setup();
    const meta = await vault.importKeyFile({ name: "from disk", deleteOriginal: true });
    expect(meta?.id).toBe("k1");
    expect(keyring.has("k1")).toBe(true);
    expect(removed).toEqual(["/home/a/id_x"]);
  });

  test("cancelling the file dialog imports nothing and deletes nothing", async () => {
    const { vault, keyring, removed } = setup(null);
    expect(await vault.importKeyFile({ name: "x", deleteOriginal: true })).toBeNull();
    expect(keyring.size).toBe(0);
    expect(vault.list()).toEqual([]);
    expect(removed).toEqual([]);
  });

  test("web: the tools that need the desktop shell report so, and the dialog finds nothing", async () => {
    const platform = createWebPlatform();
    expect(await platform.vault.pickFile()).toBeNull();
    await platform.vault.removeFile("/x");
    let message = "";
    await platform.vault.generateKey("c").catch((e: Error) => {
      message = e.message;
    });
    expect(message).toBe("ssh-keygen needs the desktop app");
  });

  test("tauri: ssh-keygen, the file dialog and the removal go through the vault_* commands", async () => {
    const invokes: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      invokes.push([cmd, args]);
      if (cmd === "vault_generate_key") return { privateKey: "PRIV", publicKey: "ssh-ed25519 PUB" };
      if (cmd === "vault_pick_file") return { path: "/home/a/id_x", text: "FILE" };
      return undefined;
    }) as never;
    const platform = tauriPlatform(window, call);
    expect(await platform.vault.generateKey("deploy")).toEqual({
      privateKey: "PRIV",
      publicKey: "ssh-ed25519 PUB",
    });
    expect(await platform.vault.pickFile()).toEqual({ path: "/home/a/id_x", text: "FILE" });
    await platform.vault.removeFile("/home/a/id_x");
    expect(invokes).toEqual([
      ["vault_generate_key", { comment: "deploy" }],
      ["vault_pick_file", undefined],
      ["vault_remove_file", { path: "/home/a/id_x" }],
    ]);
  });
});
