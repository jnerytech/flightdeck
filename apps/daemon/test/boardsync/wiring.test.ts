import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { createBoardSync } from "../../src/boardsync/index.ts";
import { DEFAULT_INTERVAL_MS } from "../../src/boardsync/loop.ts";
import { syncSetup } from "./setup.ts";

let started: { stop(): void } | null = null;
/** The delay of every timer asked of the host while the test runs, in order. */
let delays: number[] = [];

/** The daemon's wiring over a database that holds one linked project and a `gh` that always fails. */
async function wired() {
  const s = await syncSetup();
  const ghCalls: string[][] = [];
  const sync = createBoardSync({
    db: s.db,
    board: s.board,
    autoApprove: { suspend: () => {} },
    gh: async (args) => {
      ghCalls.push(args);
      return { code: 1, stdout: "", stderr: "offline" };
    },
  });
  started = sync.loop;
  delays = []; // the board's own timers are not the loop's
  /** A run is over once the loop has asked the host for the timer of the next one. */
  const timersAsked = async (count: number) => {
    for (let ticks = 0; delays.length < count; ticks += 1) {
      if (ticks > 10_000)
        throw new Error(`the loop asked for ${delays.length} timers, not ${count}`);
      await Promise.resolve();
    }
  };
  return { ...sync, ghCalls, timersAsked };
}

beforeEach(() => {
  jest.useFakeTimers();
  const hostSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return hostSetTimeout(fn, ms);
  }) as typeof setTimeout;
});
afterEach(() => {
  started?.stop();
  started = null;
  jest.useRealTimers();
});

describe("createBoardSync: the loop runs on the host's timers", () => {
  test("a started loop asks gh at once and again one interval later", async () => {
    const { loop, ghCalls, timersAsked } = await wired();
    loop.start();
    expect(ghCalls.length).toBe(0); // the first run is a timer of 0 ms, not a call inside start()
    jest.advanceTimersByTime(0);
    await timersAsked(2); // the first run, then the next one
    expect(delays).toEqual([0, DEFAULT_INTERVAL_MS]);
    const first = ghCalls.length;
    expect(ghCalls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS - 1);
    expect(ghCalls.length).toBe(first); // not before the interval
    jest.advanceTimersByTime(1);
    await timersAsked(3);
    expect(ghCalls.length).toBeGreaterThan(first);
  });

  test("a stopped loop never asks gh: stopping cancels the pending timer", async () => {
    const { loop, ghCalls } = await wired();
    loop.start();
    loop.stop();
    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS * 2);
    await Promise.resolve();
    expect(ghCalls.length).toBe(0);
  });
});
