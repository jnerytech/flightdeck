import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeepAwakeStatus } from "@flightdeck/protocol";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import type { Holder, PowerContext } from "../src/power/keep-awake.ts";
import { poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "keep-awake-token-0123456789abcdef0";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A power context that starts nothing real and counts holders that are alive. */
function fakePower() {
  const state = { started: 0, alive: 0 };
  const ctx: PowerContext = {
    platform: "linux",
    pid: 1,
    wsl: false,
    which: (name) => (name === "systemd-inhibit" ? "/usr/bin/systemd-inhibit" : null),
    hold: () => {
      state.started++;
      state.alive++;
      let end = () => {};
      const exited = new Promise<void>((resolve) => {
        end = resolve;
      });
      const holder: Holder = {
        kill: () => {
          state.alive--;
          end();
        },
        exited,
      };
      return holder;
    },
  };
  return { ctx, state };
}

async function daemon(config: Record<string, unknown> = {}) {
  const dir = tempDir();
  const { root, project } = workspace();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      history: { roots: [join(dir, "nada")] },
      ...config,
    }),
  );
  const power = fakePower();
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    { powerContext: power.ctx },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, project, file, power, running };
}

describe("keep-awake-daemon: the host announces it, holds while a session runs and obeys its switch (#163)", () => {
  test("the setting is on by default, host.info announces the feature and the status", async () => {
    const { client, file } = await daemon();
    expect((await loadConfig(file)).keepAwake).toBe(true);
    const info = await client.data<{ features?: string[]; keepAwake?: KeepAwakeStatus }>(
      "host.info",
      {},
    );
    expect(info?.features).toContain("keepAwake");
    expect(info?.keepAwake).toEqual({ enabled: true, held: false, method: null, reason: null });
  });

  test("a session that is running holds the computer awake, and the last one ending lets go", async () => {
    const { client, project, power } = await daemon();
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "[tool] escreve",
    });
    await poll(() => power.state.alive === 1, 3000);
    const held = await client.data<{ keepAwake?: KeepAwakeStatus }>("host.info", {});
    expect(held?.keepAwake).toMatchObject({ enabled: true, held: true, method: "systemd-inhibit" });
    await client.request("session.end", { sessionId: created?.sessionId });
    await poll(() => power.state.alive === 0, 3000);
    expect(power.state.started).toBe(1);
  });

  test("host.keepAwake turns it off and on, writes the config, and is felt at once", async () => {
    const { client, project, file, power } = await daemon();
    await client.data("session.create", { cwd: project, prompt: "[tool] escreve" });
    await poll(() => power.state.alive === 1, 3000);
    const off = await client.data<KeepAwakeStatus>("host.keepAwake", { enabled: false });
    expect(off).toEqual({ enabled: false, held: false, method: null, reason: null });
    expect(power.state.alive).toBe(0);
    expect((await loadConfig(file)).keepAwake).toBe(false);
    const on = await client.data<KeepAwakeStatus>("host.keepAwake", { enabled: true });
    expect(on).toMatchObject({ enabled: true, held: true });
    expect((await loadConfig(file)).keepAwake).toBe(true);
  });

  test("a host configured off starts off, and stopping the daemon lets go", async () => {
    const { client, project, power, running } = await daemon({ keepAwake: false });
    const info = await client.data<{ keepAwake?: KeepAwakeStatus }>("host.info", {});
    expect(info?.keepAwake?.enabled).toBe(false);
    await client.data("session.create", { cwd: project, prompt: "[tool] escreve" });
    await Bun.sleep(150);
    expect(power.state.started).toBe(0);
    await client.data("host.keepAwake", { enabled: true });
    await poll(() => power.state.alive === 1, 3000);
    await running.stop();
    expect(power.state.alive).toBe(0);
  });

  test.skipIf(process.platform === "win32")(
    "when the config cannot be written the switch is not changed: the client gets the error and the daemon keeps what it had",
    async () => {
      const { client, project, file, power } = await daemon();
      const dir = join(file, "..");
      chmodSync(dir, 0o500);
      cleanups.push(() => chmodSync(dir, 0o700));
      const ack = await client.request("host.keepAwake", { enabled: false });
      expect(ack.ok).toBe(false);
      const info = await client.data<{ keepAwake?: KeepAwakeStatus }>("host.info", {});
      expect(info?.keepAwake?.enabled).toBe(true);
      // And a session still holds the computer awake.
      await client.data("session.create", { cwd: project, prompt: "[tool] escreve" });
      await poll(() => power.state.alive === 1, 3000);
    },
  );
});
