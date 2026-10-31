import { afterEach, describe, expect, test } from "bun:test";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

/** A store whose desktop tools (ssh-keygen, the file dialog, the save dialog) all break. */
function broken() {
  const { platform } = memoryPlatform();
  const boom = async (): Promise<never> => {
    throw new Error("the shell broke");
  };
  platform.vault.generateKey = boom;
  platform.vault.pickFile = boom;
  platform.saveFile = boom;
  const store = new AppStore(platform, { baseDelayMs: 60_000, vaultWorkFactor: 4 });
  stores.push(store);
  return store;
}

const errors = (store: ReturnType<typeof broken>) =>
  store
    .getState()
    .notices.filter((n) => n.kind === "error")
    .map((n) => n.text);

describe("cofre-store: a tool of the shell that fails", () => {
  test("generating a key reports the error and stores nothing", async () => {
    const store = broken();
    expect(await store.generateSshKey({ name: "deploy" })).toBeNull();
    expect(errors(store)).toEqual(["the shell broke"]);
    expect(store.getState().secrets).toEqual([]);
  });

  test("importing a key file reports the error and stores nothing", async () => {
    const store = broken();
    expect(await store.importKeyFile({ name: "deploy" })).toBeNull();
    expect(errors(store)).toEqual(["the shell broke"]);
    expect(store.getState().secrets).toEqual([]);
  });

  test("a save dialog that fails reports the error and the export is not done", async () => {
    const store = broken();
    const pass = "uma frase bem longa";
    expect(await store.exportVault(pass, pass)).toEqual({ ok: false, code: "cancelled" });
    expect(errors(store)).toEqual(["the shell broke"]);
  });

  test("a file dialog that fails reports the error and there is no preview", async () => {
    const store = broken();
    expect(await store.previewVaultImport("uma frase bem longa")).toEqual({
      ok: false,
      code: "cancelled",
    });
    expect(errors(store)).toEqual(["the shell broke"]);
  });
  test("a clipboard that cannot be cleared after a copy stays quiet: the copy already succeeded", async () => {
    const { platform } = memoryPlatform();
    const copied: string[] = [];
    platform.copyText = async (text) => {
      if (text === "") throw new Error("the clipboard broke");
      copied.push(text);
    };
    const store = new AppStore(platform, { baseDelayMs: 60_000 });
    stores.push(store);
    const meta = await store.addSecret({ name: "deploy", type: "token", value: "v-123" });
    expect(await store.copySecret(meta.id, 5)).toBe(true);
    await Bun.sleep(40);
    expect(copied).toEqual(["v-123"]);
    expect(errors(store)).toEqual([]);
  });
});
