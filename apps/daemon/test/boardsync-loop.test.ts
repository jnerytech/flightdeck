import { describe, expect, test } from "bun:test";
import type { SyncReport } from "../src/boardsync/engine.ts";
import {
  BoardSyncLoop,
  DEFAULT_INTERVAL_MS,
  MAX_BACKOFF_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
} from "../src/boardsync/loop.ts";
import { syncSetup } from "./boardsync-setup.ts";
import { manualTime } from "./time-helpers.ts";

const REPORT: SyncReport = {
  created: 0,
  moved: 0,
  updated: 0,
  conflicts: 0,
  unmapped: 0,
  gone: 0,
  skipped: 0,
  pushed: 0,
  redacted: 0,
  truncated: false,
  notModified: true,
};

/** A loop over a stub engine whose runs the test controls. */
async function loopSetup(intervalMs?: number) {
  const s = await syncSetup();
  const time = manualTime();
  const calls: string[] = [];
  const updates: string[] = [];
  const gate = { hold: null as null | (() => void), fail: null as null | Error };
  const engine = {
    syncProject: async (projectId: string) => {
      calls.push(projectId);
      if (gate.hold !== undefined && gate.hold !== null) {
        await new Promise<void>((resolve) => {
          gate.hold = resolve;
        });
      }
      if (gate.fail) throw gate.fail;
      return REPORT;
    },
  };
  const loop = new BoardSyncLoop({
    engine,
    store: s.store,
    timers: time.timers,
    clock: time.now,
    ...(intervalMs === undefined ? {} : { intervalMs }),
    onUpdate: (projectId) => updates.push(projectId),
  });
  const live = () => time.pending.filter((timer) => !timer.cleared).length;
  /** Lets the awaited work of a run drain its microtasks. */
  const drain = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return { ...s, time, calls, updates, gate, loop, live, drain, project: s.project.id };
}

const failure = (reason: string, params?: Record<string, string>) =>
  Object.assign(new Error(reason), { reason, params });

describe("board-sync-loop: polling, one run at a time, back off and pauses", () => {
  test("the interval is 60 s, never under 15 s and never over 10 min", async () => {
    expect((await loopSetup()).loop.intervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect((await loopSetup(1000)).loop.intervalMs).toBe(MIN_INTERVAL_MS);
    expect((await loopSetup(99 * 60_000)).loop.intervalMs).toBe(MAX_INTERVAL_MS);
  });

  test("a linked project is synced at start and then at each interval", async () => {
    const s = await loopSetup();
    s.loop.start();
    s.time.advance(0);
    await s.drain();
    expect(s.calls).toEqual([s.project]);
    s.time.advance(DEFAULT_INTERVAL_MS);
    await s.drain();
    s.time.advance(DEFAULT_INTERVAL_MS);
    await s.drain();
    expect(s.calls).toHaveLength(3);
    expect(s.updates).toHaveLength(3);
  });

  test("one run at a time: a run still going is not started again", async () => {
    const s = await loopSetup();
    s.gate.hold = () => {};
    s.loop.start();
    s.time.advance(0);
    await s.drain();
    const first = s.loop.syncNow(s.project);
    const second = s.loop.syncNow(s.project);
    await s.drain();
    expect(s.calls).toHaveLength(1);
    s.gate.hold?.();
    s.gate.hold = null;
    expect(await first).toBe(await second);
    expect(s.calls).toHaveLength(1);
  });

  test("syncNow runs at once, and the next poll is an interval after it", async () => {
    const s = await loopSetup();
    s.loop.start();
    await s.loop.syncNow(s.project);
    expect(s.calls).toHaveLength(1);
    s.time.advance(DEFAULT_INTERVAL_MS - 1);
    await s.drain();
    expect(s.calls).toHaveLength(1);
    s.time.advance(1);
    await s.drain();
    expect(s.calls).toHaveLength(2);
  });

  test("errors back off 1, 2, 4 minutes up to 15, and a success goes back to the interval", async () => {
    const s = await loopSetup();
    s.gate.fail = failure("board_sync_failed");
    s.loop.start();
    const waits: number[] = [];
    let seen = 0;
    s.time.advance(0);
    await s.drain();
    for (const wait of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
      s.time.advance(wait - 1);
      await s.drain();
      expect(s.calls).toHaveLength(seen + 1);
      s.time.advance(1);
      await s.drain();
      seen += 1;
      waits.push(wait);
      expect(s.calls).toHaveLength(seen + 1);
    }
    expect(waits.at(-1)).toBe(MAX_BACKOFF_MS);
    s.gate.fail = null;
    s.time.advance(MAX_BACKOFF_MS);
    await s.drain();
    s.time.advance(DEFAULT_INTERVAL_MS);
    await s.drain();
    expect(s.calls).toHaveLength(seen + 3);
  });

  test("a rate limit pauses the board until the reset time, and says when", async () => {
    const s = await loopSetup();
    const resetAt = new Date(s.time.now() + 5 * 60_000).toISOString();
    s.gate.fail = failure("board_sync_rate_limited", { resetAt });
    s.loop.start();
    s.time.advance(0);
    await s.drain();
    expect(s.store.get(s.project)?.pausedUntil).toBe(resetAt);
    s.gate.fail = null;
    s.time.advance(4 * 60_000);
    await s.drain();
    expect(s.calls).toHaveLength(1);
    s.time.advance(60_000);
    await s.drain();
    expect(s.calls).toHaveLength(2);
    expect(s.store.get(s.project)?.pausedUntil).toBeNull();
  });

  test("stop leaves no timer, and a run that ends after it schedules nothing", async () => {
    const s = await loopSetup();
    s.gate.hold = () => {};
    s.loop.start();
    s.time.advance(0);
    await s.drain();
    s.loop.stop();
    s.gate.hold?.();
    s.gate.hold = null;
    await s.drain();
    expect(s.live()).toBe(0);
  });

  test("watch adds a project that was linked after the start, unwatch drops it", async () => {
    const s = await loopSetup();
    s.store.unlink(s.project);
    s.loop.start();
    s.time.advance(DEFAULT_INTERVAL_MS);
    await s.drain();
    expect(s.calls).toEqual([]);
    s.store.link({
      projectId: s.project,
      provider: "fake",
      boardId: "PVT_board1",
      boardTitle: "Roadmap",
      statusFieldId: "f",
      columnMap: {},
    });
    s.loop.watch(s.project);
    s.time.advance(0);
    await s.drain();
    expect(s.calls).toEqual([s.project]);
    s.loop.unwatch(s.project);
    expect(s.live()).toBe(0);
  });
});
