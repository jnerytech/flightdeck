import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Config } from "../src/config.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { UpdateChecker } from "../src/updates/check.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "auto-update-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A local release server: the manifest on one path, a binary whose sha256 the manifest gets wrong on the other. */
function releaseServer(version: string) {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const base = new URL(request.url).origin;
      if (new URL(request.url).pathname === "/binary") return new Response("not the real binary");
      const asset = { url: `${base}/binary`, sha256: "a".repeat(64), signature: "s" };
      const assets = { "linux-x64": asset, "linux-arm64": asset, "windows-x64": asset };
      return Response.json({ version, protocol: 1, assets });
    },
  });
  cleanups.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}/daemon-latest.json`;
}

async function daemon(updates: Record<string, unknown>) {
  const dir = tempDir();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      hooks: { port: 0 },
      updates,
    }),
  );
  const lines: string[] = [];
  const running = await runCli(["--config", file, "--runtime", "fake"], {
    env: {},
    log: { log: (line: string) => void lines.push(line), error: () => {} },
    exit: () => {},
    onSignal: () => {},
  });
  cleanups.push(() => running?.stop());
  const client = new FrameClient(running?.url ?? "");
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, lines };
}

type Info = {
  features?: string[];
  autoUpdate?: { enabled: boolean; state: string; reason?: string };
};

describe("auto-update-daemon: the setting, the check hook and what the host reports (#280)", () => {
  test("the config has updates.auto, on by default", () => {
    expect(Config.parse({}).updates.auto).toBe(true);
    expect(Config.parse({ updates: { auto: false } }).updates.auto).toBe(false);
    expect(() => Config.parse({ updates: { auto: "yes" } })).toThrow();
  });

  test("the checker tells the auto updater after every check, a failed one too", async () => {
    let calls = 0;
    const ok = new UpdateChecker({
      manifestUrl: releaseServer("0.9.0"),
      checkIntervalH: 6,
      currentVersion: "0.8.0",
      onChecked: () => void calls++,
    });
    cleanups.push(() => ok.stop());
    await ok.start();
    await ok.checkNow();
    expect(calls).toBe(2);
    const down = new UpdateChecker({
      manifestUrl: "http://127.0.0.1:9/daemon-latest.json",
      checkIntervalH: 6,
      currentVersion: "0.8.0",
      onChecked: () => void calls++,
    });
    cleanups.push(() => down.stop());
    await down.start();
    expect(calls).toBe(3);
  });

  test("a hook that throws does not stop the checks", async () => {
    let calls = 0;
    const checker = new UpdateChecker({
      manifestUrl: releaseServer("0.9.0"),
      checkIntervalH: 6,
      currentVersion: "0.8.0",
      onChecked: async () => {
        calls++;
        throw new Error("boom");
      },
    });
    cleanups.push(() => checker.stop());
    await checker.start();
    await checker.checkNow();
    expect(calls).toBe(2);
    expect(checker.status()).toMatchObject({ available: true, version: "0.9.0" });
  });

  test("host.info announces autoUpdate and its state; host.updates.set changes the setting and answers with the state", async () => {
    const { manager } = newManager();
    let auto = true;
    const status = () => ({
      enabled: auto,
      state: auto ? ("current" as const) : ("off" as const),
    });
    const base = { manager, hostName: "h", bind: "127.0.0.1", port: 0, token: TOKEN };
    const server = startServer({
      ...base,
      allowedRoots: [],
      autoUpdate: {
        status,
        set: async (next: boolean) => {
          auto = next;
          return status();
        },
      },
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<Info>("host.info", {});
    expect(info?.features).toContain("autoUpdate");
    expect(info?.autoUpdate).toEqual({ enabled: true, state: "current" });
    expect(await client.data("host.updates.set", { auto: false })).toEqual({
      enabled: false,
      state: "off",
    });
    expect((await client.data<Info>("host.info", {}))?.autoUpdate).toEqual({
      enabled: false,
      state: "off",
    });
    const plain = startServer({ ...base, allowedRoots: [] });
    cleanups.push(() => plain.stop());
    const other = new FrameClient(plain.url);
    cleanups.push(() => other.close());
    await other.request("hello", { token: TOKEN, client: "t" });
    const bare = await other.data<Info>("host.info", {});
    expect(bare?.autoUpdate).toBeUndefined();
    expect(bare?.features).not.toContain("autoUpdate");
    const refused = await other.request("host.updates.set", { auto: true });
    expect(JSON.stringify(refused)).toContain("autoUpdate");
  });

  test("a running daemon with the setting on and an idle host tries the newer version at once, and a bad download leaves it failed and the old version in place", async () => {
    const { client, lines } = await daemon({ manifestUrl: releaseServer("999.0.0") });
    expect(
      await poll(() => lines.find((l) => l.startsWith("auto update: 999.0.0 failed"))),
    ).toContain("sha256");
    const info = await client.data<Info>("host.info", {});
    expect(info?.autoUpdate?.state).toBe("failed");
    expect(info?.autoUpdate?.reason).toBe("update_signature_failed");
  });

  test("with updates.auto false nothing is applied, and the host says so; turning it on later applies at once", async () => {
    const { client, lines } = await daemon({ manifestUrl: releaseServer("999.0.0"), auto: false });
    expect((await client.data<Info>("host.info", {}))?.autoUpdate).toEqual({
      enabled: false,
      state: "off",
    });
    expect(lines.some((l) => l.startsWith("auto update:"))).toBe(false);
    await client.data("host.updates.set", { auto: true });
    expect(
      await poll(() => lines.find((l) => l.startsWith("auto update: 999.0.0 failed"))),
    ).toBeTruthy();
  });
});
