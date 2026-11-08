import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QuotaState } from "@flightdeck/protocol";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { Quota } from "../src/quota/quota.ts";
import { poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "quota-pause-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function daemon(config: Record<string, unknown> = {}) {
  const dir = tempDir();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [dir],
      history: { roots: [join(dir, "nada")] },
      ...config,
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, file };
}

describe("quota-pause-at: the guard 'new cards wait from N%' is a host setting the app can change (#1218)", () => {
  test("Quota.setPauseAt changes what blocks a new card and tells every watcher", () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    const quota = new Quota({
      pauseAt: 0.9,
      now: () => now,
      timers: { set: () => 0, clear: () => {} },
    });
    quota.record([
      { window: "five_hour", utilization: 0.75, status: "allowed", resetsAt: now + 3600_000 },
    ]);
    const seen: Array<number | null> = [];
    quota.watch((state) => seen.push(state.pauseAt));
    expect(quota.blocked()).toBeNull();

    quota.setPauseAt(0.7);
    expect(quota.state().pauseAt).toBe(0.7);
    expect(quota.blocked()).toMatchObject({ window: "five_hour", until: now + 3600_000 });

    quota.setPauseAt(null);
    expect(quota.state().pauseAt).toBeNull();
    expect(quota.blocked()).toBeNull();
    expect(seen).toEqual([0.7, null]);
  });

  test("quota.setPauseAt answers with the new state, writes the config and the next quota.get agrees", async () => {
    const { client, file } = await daemon();
    expect((await loadConfig(file)).quota.pauseAt).toBe(0.9);
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain("quotaPause");

    const set = await client.data<QuotaState>("quota.setPauseAt", { pauseAt: 0.7 });
    expect(set).toEqual({ windows: [], pauseAt: 0.7 });
    expect((await loadConfig(file)).quota.pauseAt).toBe(0.7);
    expect((await client.data<QuotaState>("quota.get", {}))?.pauseAt).toBe(0.7);

    const off = await client.data<QuotaState>("quota.setPauseAt", { pauseAt: null });
    expect(off?.pauseAt).toBeNull();
    expect((await loadConfig(file)).quota.pauseAt).toBeNull();
    expect((await client.data<QuotaState>("quota.get", {}))?.pauseAt).toBeNull();
  });

  test("a watching app sees the new guard at once, even the one that did not change it", async () => {
    const { client, file } = await daemon();
    const other = new FrameClient(client.ws.url);
    cleanups.push(() => other.close());
    await other.request("hello", { token: TOKEN, client: "other" });
    await other.request("quota.watch", {});
    await client.data("quota.setPauseAt", { pauseAt: 0.8 });
    const frame = await poll(
      () => other.frames.find((f) => f.type === "quota.updated" && f.pauseAt === 0.8),
      3000,
    );
    expect(frame).toBeDefined();
    expect((await loadConfig(file)).quota.pauseAt).toBe(0.8);
  });

  test("a value outside 0 to 1, or not a number, is refused as a bad pauseAt and the guard stays", async () => {
    const { client, file } = await daemon();
    for (const payload of [
      { pauseAt: 1.5 },
      { pauseAt: -0.1 },
      { pauseAt: "0.8" },
      { pauseAt: Number.NaN },
      {},
    ]) {
      const ack = await client.request("quota.setPauseAt", payload);
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatchObject({
        code: "bad_request",
        reason: "request_invalid",
        params: { command: "quota.setPauseAt", field: "pauseAt" },
      });
    }
    expect((await client.data<QuotaState>("quota.get", {}))?.pauseAt).toBe(0.9);
    expect((await loadConfig(file)).quota.pauseAt).toBe(0.9);
  });

  test.skipIf(process.platform === "win32")(
    "when the config cannot be written the guard is not changed: the client gets the error and the daemon keeps what it had",
    async () => {
      const { client, file } = await daemon();
      const dir = join(file, "..");
      chmodSync(dir, 0o500);
      cleanups.push(() => chmodSync(dir, 0o700));
      const ack = await client.request("quota.setPauseAt", { pauseAt: 0.5 });
      expect(ack.ok).toBe(false);
      // A failed write, not a refused request.
      expect((ack.error as { code: string }).code).not.toBe("bad_request");
      expect((await client.data<QuotaState>("quota.get", {}))?.pauseAt).toBe(0.9);
    },
  );
});
