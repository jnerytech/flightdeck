import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { createBoardSync } from "../../src/boardsync/index.ts";
import { syncSetup } from "./setup.ts";

/** `gh` always fails here, so the loop's next run waits the backoff of one failure, not the polling interval. */
const FIRST_FAILURE_BACKOFF_MS = 60_000;

let started: { stop(): void } | null = null;

/** Lets a run of the loop finish: far more microtask hops than it takes to reach gh and arm the next timer. */
async function drain() {
  for (let tick = 0; tick < 200; tick += 1) await Promise.resolve();
}

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
  return { ...sync, ghCalls };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  started?.stop();
  started = null;
  jest.useRealTimers();
});

describe("createBoardSync: the loop runs on the host's timers", () => {
  test("a started loop asks gh at once and, after a failed run, again once the backoff has passed", async () => {
    const { loop, ghCalls } = await wired();
    loop.start();
    expect(ghCalls.length).toBe(0); // the first run is a timer of 0 ms, not a call inside start()
    jest.advanceTimersByTime(0);
    await drain();
    const first = ghCalls.length;
    expect(first).toBeGreaterThan(0); // weaker: how many gh calls one run makes is the engine's business, not the wiring's
    expect(ghCalls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
    jest.advanceTimersByTime(FIRST_FAILURE_BACKOFF_MS - 1);
    await drain();
    expect(ghCalls.length).toBe(first); // not before the backoff
    jest.advanceTimersByTime(1);
    await drain();
    expect(ghCalls.length).toBeGreaterThan(first); // weaker: the second run's call count is the engine's business too
  });

  test("a stopped loop never asks gh: stopping cancels the pending timer", async () => {
    const { loop, ghCalls } = await wired();
    loop.start();
    loop.stop();
    jest.advanceTimersByTime(FIRST_FAILURE_BACKOFF_MS * 2);
    await drain();
    expect(ghCalls.length).toBe(0);
  });
});
