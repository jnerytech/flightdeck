import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostInfoResult, UiSettings } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "t".repeat(32);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Given a config file (with the `ui` setting it is told to carry), start a daemon on it. */
function config(ui?: Record<string, unknown>) {
  const dir = tempDir();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ port: 0, token: TOKEN, dataDir: join(dir, "data"), ...(ui ? { ui } : {}) }),
  );
  return file;
}

async function run(file: string) {
  const daemon = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
  );
  cleanups.push(() => daemon.stop());
  const client = new FrameClient(daemon.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { daemon, client };
}

describe("simple-mode-host: the host's default mode and lock", () => {
  test("Given a fresh config, When host.info is asked, Then ui is full and unlocked and the feature is announced", async () => {
    const { client } = await run(config());
    const info = await client.data<HostInfoResult>("host.info", {});
    expect(info?.ui).toEqual({ mode: "full", locked: false });
    expect(info?.features).toContain("ui.mode");
  });

  test("Given a config that sets simple and locked, When host.info is asked, Then it says so", async () => {
    const { client } = await run(config({ mode: "simple", locked: true }));
    const info = await client.data<HostInfoResult>("host.info", {});
    expect(info?.ui).toEqual({ mode: "simple", locked: true });
  });

  test("Given an unknown mode in the config, When the daemon reads it, Then it falls back to full", async () => {
    const file = config({ mode: "wild", locked: "yes" });
    const { client } = await run(file).catch(() => ({ client: null }));
    // An unreadable setting must not stop the host from starting in full mode.
    expect(client).not.toBeNull();
    const info = await client?.data<HostInfoResult>("host.info", {});
    expect(info?.ui).toEqual({ mode: "full", locked: false });
  });

  test("Given a host in full mode, When ui.set simple with confirm, Then the host says simple, the config keeps it and a restart still has it", async () => {
    const file = config();
    const first = await run(file);
    const set = await first.client.data<UiSettings>("ui.set", { mode: "simple", confirm: true });
    expect(set).toEqual({ mode: "simple", locked: false });
    const info = await first.client.data<HostInfoResult>("host.info", {});
    expect(info?.ui).toEqual({ mode: "simple", locked: false });
    await first.daemon.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).ui).toEqual({ mode: "simple", locked: false });
    const second = await run(file);
    const again = await second.client.data<HostInfoResult>("host.info", {});
    expect(again?.ui).toEqual({ mode: "simple", locked: false });
  });

  test("Given a simple host, When ui.set only locks, Then the mode is kept", async () => {
    const { client } = await run(config({ mode: "simple" }));
    const set = await client.data<UiSettings>("ui.set", { locked: true, confirm: true });
    expect(set).toEqual({ mode: "simple", locked: true });
  });

  test("When ui.set has no confirm or a mode it does not know, Then it is refused and nothing changes", async () => {
    const { client } = await run(config());
    const noConfirm = await client.request("ui.set", { mode: "simple" });
    expect(noConfirm.ok).toBe(false);
    expect((noConfirm.error as { reason?: string }).reason).toBe("ui_confirm");
    const unknown = await client.request("ui.set", { mode: "wild", confirm: true });
    expect(unknown.ok).toBe(false);
    const info = await client.data<HostInfoResult>("host.info", {});
    expect(info?.ui).toEqual({ mode: "full", locked: false });
  });
});
