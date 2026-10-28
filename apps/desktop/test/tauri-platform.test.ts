import { describe, expect, mock, test } from "bun:test";

const calls: Array<[string, unknown]> = [];
let granted = false;
let permissionAnswer = "denied";
const sent: unknown[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    calls.push([cmd, args]);
    return cmd === "token_get" ? "segredo" : undefined;
  },
}));
mock.module("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => granted,
  requestPermission: async () => permissionAnswer,
  sendNotification: (n: unknown) => sent.push(n),
}));

const { tauriPlatform } = await import("../src/lib/tauri-platform.ts");

describe("desktop: plataforma Tauri", () => {
  const items = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    },
    document: { hasFocus: () => true },
  };

  test("tokens passam pelos comandos do keyring", async () => {
    const platform = tauriPlatform(fakeWindow);
    expect(await platform.getToken("h1")).toBe("segredo");
    await platform.setToken("h1", "novo");
    await platform.deleteToken("h1");
    expect(calls).toEqual([
      ["token_get", { hostId: "h1" }],
      ["token_set", { hostId: "h1", token: "novo" }],
      ["token_delete", { hostId: "h1" }],
    ]);
    platform.storage.setItem("k", "v");
    expect(platform.storage.getItem("k")).toBe("v");
    expect(platform.isFocused()).toBe(true);
  });

  test("notificação pede permissão uma vez e só envia se concedida", async () => {
    const platform = tauriPlatform(fakeWindow);
    await platform.notify({ title: "a", body: "b" });
    expect(sent).toEqual([]);
    permissionAnswer = "granted";
    await platform.notify({ title: "c", body: "d" });
    granted = true;
    await platform.notify({ title: "e", body: "f" });
    expect(sent).toEqual([
      { title: "c", body: "d" },
      { title: "e", body: "f" },
    ]);
  });
});
