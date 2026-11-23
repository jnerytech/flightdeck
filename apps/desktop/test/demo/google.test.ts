import { describe, expect, test } from "bun:test";
import { demoStoreOptions } from "../../src/demo/boot.ts";
import { demoGoogle, withDemoGoogle } from "../../src/demo/google.ts";
import { driveTarget } from "../../src/features/backup/drive-target.ts";
import { googleSignIn, REFRESH_TOKEN_ID } from "../../src/features/backup/google-oauth.ts";
import type { Platform } from "../../src/platform/types.ts";
import { memoryPlatform } from "../fixtures.ts";

/**
 * Issue #4348: the demo's Google, so the prints can show the backup screens that need a Google
 * client: the address's `?google=` picks how Google answers, and nothing leaves the page.
 */
async function signedIn(mode: string) {
  const search = `?google=${mode}`;
  const google = demoGoogle(search);
  expect(google).not.toBeNull();
  const { config, fetch } = google as NonNullable<typeof google>;
  const platform = withDemoGoogle(memoryPlatform().platform, search);
  const vault = new Map<string, string>();
  const keyring: Platform["vault"] = {
    ...platform.vault,
    get: async (id) => vault.get(id) ?? null,
    set: async (id, value) => {
      vault.set(id, value);
    },
    delete: async (id) => {
      vault.delete(id);
    },
  };
  const loopback = platform.oauthLoopback;
  expect(loopback).toBeDefined();
  const sign = googleSignIn({
    config,
    fetch,
    vault: keyring,
    loopback: loopback as NonNullable<typeof loopback>,
    openExternal: (url) => platform.openExternal(url),
  });
  const result = await sign.signIn();
  return { sign, result, vault, drive: driveTarget({ fetch, auth: sign.auth }) };
}

describe("the demo's Google (#4348)", () => {
  test("an address without ?google= has no Google and the platform keeps what it had", () => {
    const { platform } = memoryPlatform();
    expect(demoGoogle("")).toBeNull();
    expect(demoGoogle("?google=nonsense")).toBeNull();
    expect(withDemoGoogle(platform, "").oauthLoopback).toBeUndefined();
  });

  test("the store options carry the demo's Google only when the address names one", () => {
    expect(demoStoreOptions([], "?google=files").google?.config).toEqual({ clientId: "demo" });
    expect(demoStoreOptions([], "").google).toBeUndefined();
  });

  test("files: the sign-in works, keeps its refresh token, and Drive lists four backups", async () => {
    const { result, vault, drive } = await signedIn("files");
    expect([result, vault.has(REFRESH_TOKEN_ID)]).toEqual(["signed-in", true]);
    const names = await drive.list();
    expect(names).toHaveLength(4);
    expect(names.every((name) => /^flightdeck-backup-\d{8}-\d{6}\.fdbackup$/.test(name))).toBe(
      true,
    );
  });

  test("empty: signed in and nothing on Drive", async () => {
    const { drive } = await signedIn("empty");
    expect(await drive.list()).toEqual([]);
  });

  test("refused: Google does not accept the sign-in", async () => {
    const { result, vault } = await signedIn("refused");
    expect([result, vault.has(REFRESH_TOKEN_ID)]).toEqual(["refused", false]);
  });

  test("revoked: the sign-in worked once, and now Drive reads as an auth failure", async () => {
    const { drive } = await signedIn("revoked");
    expect(await drive.list().catch((error: { kind?: string }) => error.kind)).toBe("auth");
  });

  test("down: Drive answers with a server error", async () => {
    const { drive } = await signedIn("down");
    expect(await drive.list().catch((error: { kind?: string }) => error.kind)).toBe("http");
  });

  test("the browser opens nothing: the demo's openExternal answers and has no window to open", async () => {
    const platform = withDemoGoogle(memoryPlatform().platform, "?google=files");
    expect(platform.oauthLoopback).toBeDefined();
    const listener = await (
      platform.oauthLoopback as NonNullable<Platform["oauthLoopback"]>
    ).listen("s1");
    expect(await listener.wait()).toEqual({ code: "demo", state: "s1" });
    await expect(platform.openExternal("https://accounts.google.com")).resolves.toBeUndefined();
  });
});
