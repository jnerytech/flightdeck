import { describe, expect, test } from "bun:test";
import { runAction } from "../src/actions/run.ts";
import { validateAction } from "../src/actions/schema.ts";
import { tempDir } from "./helpers.ts";

/** A program that starts at once and ends only when it is killed, and a clock that moves by hand. */
function fakes() {
  const killed: number[] = [];
  const spawned: string[][] = [];
  let end: (code: number) => void = () => {};
  const open = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => controller.close();
        void killedSignal.then(close);
      },
    });
  let release: () => void = () => {};
  const killedSignal = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spawn = ((argv: string[]) => {
    spawned.push(argv);
    return {
      stdout: open(),
      stderr: new ReadableStream<Uint8Array>({
        start: (c) => void killedSignal.then(() => c.close()),
      }),
      exited: new Promise<number>((resolve) => {
        end = resolve;
      }),
      kill: () => {
        killed.push(1);
        release();
        end(143);
      },
      pid: 1,
    };
  }) as unknown as typeof Bun.spawn;
  const timers: Array<() => void> = [];
  const cleared: unknown[] = [];
  const timer = {
    set: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clear: (handle: unknown) => void cleared.push(handle),
  };
  return { spawn, spawned, killed, timers, cleared, timer, finish: () => end(0), release };
}

/** Yields until the action has started its program (it prepares a folder first). */
const started = async (f: { spawned: string[][] }) => {
  while (f.spawned.length === 0) await Bun.sleep(0);
};

const make = () => {
  const { action, errors } = validateAction({
    name: "demorada",
    description: "uma ação que demora",
    run: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
  });
  if (!action) throw new Error(errors.join("; "));
  return action;
};

describe("acoes-tempo: the time limit is a timer the test moves, not wall-clock time (issue #231)", () => {
  test("when the timer fires the program is killed and the result says it timed out, with no sleep and no real process", async () => {
    const f = fakes();
    const run = runAction(
      make(),
      {},
      {},
      {
        base: tempDir(),
        timeoutMs: 250,
        spawn: f.spawn,
        timer: f.timer,
      },
    );
    // Nothing has been killed while the timer has not fired.
    await started(f);
    expect(f.spawned).toHaveLength(1);
    expect(f.killed).toEqual([]);
    f.timers[0]?.();
    const result = await run;
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(143);
    expect(f.killed).toEqual([1]);
  });

  test("a program that ends by itself clears its timer and is not timed out, however long it took", async () => {
    const f = fakes();
    const run = runAction(
      make(),
      {},
      {},
      {
        base: tempDir(),
        timeoutMs: 250,
        spawn: f.spawn,
        timer: f.timer,
      },
    );
    await started(f);
    f.release();
    f.finish();
    const result = await run;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(f.killed).toEqual([]);
    expect(f.cleared).toHaveLength(1);
  });
});
