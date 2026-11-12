import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../../src/main.ts";
import type { Holder, PowerContext } from "../../src/power/keep-awake.ts";
import type { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
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
});
