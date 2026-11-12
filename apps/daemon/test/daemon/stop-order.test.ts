import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Automations } from "../../src/automations/automations.ts";
import { Board } from "../../src/board/board.ts";
import { BoardSyncLoop } from "../../src/boardsync/loop.ts";
import { UsageIndexer } from "../../src/costs/usage-indexer.ts";
import { HistoryIndexer } from "../../src/history/indexer.ts";
import { startDaemon } from "../../src/main.ts";
import { Maintenance } from "../../src/maintenance/maintenance.ts";
import type { Holder, PowerContext } from "../../src/power/keep-awake.ts";
import { KeepAwake } from "../../src/power/keep-awake.ts";
import { Quota } from "../../src/quota/quota.ts";
import type { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { SessionManager } from "../../src/sessions/session-manager.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { Teams } from "../../src/teams/teams.ts";
import { TeleportPackages } from "../../src/teleport/package.ts";
import { PrWatch } from "../../src/watch/service.ts";
import { poll, tempDir, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "stop-order-token-0123456789abcdef0";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A power context that starts nothing real and writes down when its holder lets go. */
function fakePower(order: string[]) {
  const state = { alive: 0 };
  const ctx: PowerContext = {
    platform: "linux",
    pid: 1,
    wsl: false,
    which: (name) => (["systemd-inhibit", "tail"].includes(name) ? `/usr/bin/${name}` : null),
    hold: () => {
      state.alive++;
      let end = () => {};
      const exited = new Promise<void>((resolve) => {
        end = resolve;
      });
      const holder: Holder = {
        kill: () => {
          state.alive--;
          order.push("keep-awake let go");
          end();
        },
        exited,
      };
      return holder;
    },
  };
  return { ctx, state };
}

/**
 * Issue #1593: the stop order main.ts states in comments, pinned by what a client and the host's
 * own fakes see, before any move of the stop sequence: whatever stops slowly must not keep the
 * computer awake meanwhile. The log flushed last and the teleport packages gone are pinned in
 * logs/server.test.ts and teleport/bundle.test.ts.
 */
describe("stop-order: what a stopping daemon lets go first", () => {
  test("the computer is let go before the running sessions close", async () => {
    const order: string[] = [];
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
      }),
    );
    const power = fakePower(order);
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { powerContext: power.ctx },
    );
    cleanups.push(() => running.stop());
    // Each run the fake runtime starts writes down when the daemon closes it.
    const runtime = running.runtime as FakeRuntime;
    const start = runtime.start.bind(runtime);
    runtime.start = (opts) => {
      const run = start(opts);
      const close = run.close.bind(run);
      run.close = () => {
        order.push("session run closed");
        return close();
      };
      return run;
    };
    const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    await client.data("session.create", { cwd: project, prompt: "[tool] escreve" });
    await poll(() => power.state.alive === 1, 3000);

    await running.stop();
    expect(order).toEqual(["keep-awake let go", "session run closed"]);
  });

  test("every domain stops once, the board's work before the board, the late ones after the sessions, the store last (#2094)", async () => {
    const dir = tempDir();
    const { root } = workspace();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      { powerContext: fakePower([]).ctx },
    );
    // Written down once the daemon is up: only what its stop calls, in the order it calls it.
    const order: string[] = [];
    const record = (proto: object, method: string, name: string) => {
      const target = proto as Record<string, (...args: unknown[]) => unknown>;
      const original = target[method] as (...args: unknown[]) => unknown;
      target[method] = function (this: unknown, ...args: unknown[]) {
        order.push(name);
        return original.apply(this, args);
      };
      cleanups.push(() => {
        target[method] = original;
      });
    };
    const stops: Array<[object, string, string]> = [
      [KeepAwake.prototype, "stop", "keepAwake"],
      [Automations.prototype, "stop", "automations"],
      [PrWatch.prototype, "stop", "watch"],
      [BoardSyncLoop.prototype, "stop", "boardSync"],
      [Teams.prototype, "stop", "teams"],
      [Maintenance.prototype, "stop", "maintenance"],
      [Board.prototype, "stop", "board"],
      [SessionManager.prototype, "shutdown", "sessions"],
      [TeleportPackages.prototype, "stop", "teleport"],
      [HistoryIndexer.prototype, "stop", "history"],
      [UsageIndexer.prototype, "stop", "usageIndex"],
      [Quota.prototype, "stop", "quota"],
      [EventStore.prototype, "close", "store"],
    ];
    for (const [proto, method, name] of stops) record(proto, method, name);
    // The drain is written down when it ends, not when it is asked for.
    const automations = Automations.prototype as unknown as { idle: () => Promise<void> };
    const idle = automations.idle;
    automations.idle = async function (this: Automations) {
      await idle.call(this);
      order.push("drained");
    };
    cleanups.push(() => {
      automations.idle = idle;
    });

    await running.stop();
    const at = (name: string) => order.indexOf(name);
    const names = stops.map(([, , name]) => name);
    expect(names.filter((name) => order.filter((n) => n === name).length !== 1)).toEqual([]);
    expect([
      ["keep-awake first", at("keepAwake") === 0],
      ["the automations stopped, then drained", at("automations") < at("drained")],
      [
        "drained before the watch and the board sync",
        at("drained") < Math.min(at("watch"), at("boardSync")),
      ],
      [
        "the watch and the board sync before the board",
        Math.max(at("watch"), at("boardSync")) < at("board"),
      ],
      ["the sessions after the board", at("board") < at("sessions")],
      [
        "the late ones after the sessions",
        ["teleport", "history", "usageIndex", "quota"].every((name) => at("sessions") < at(name)),
      ],
      ["the store last", at("store") === order.length - 1],
    ]).toEqual([
      ["keep-awake first", true],
      ["the automations stopped, then drained", true],
      ["drained before the watch and the board sync", true],
      ["the watch and the board sync before the board", true],
      ["the sessions after the board", true],
      ["the late ones after the sessions", true],
      ["the store last", true],
    ]);
  });
});
