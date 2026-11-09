import { describe, expect, test } from "bun:test";
import type { SessionEvent, SessionStatus, SessionSummary } from "@flightdeck/protocol";
import { ActivityClock } from "../src/sessions/activity-clock.ts";
import {
  type QuietInfo,
  type StallHost,
  type StallTimers,
  StallWatcher,
} from "../src/sessions/stall.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-11-09T12:00:00Z");

const toolUse = (id: string, name: string): SessionEvent => ({
  type: "message.assistant",
  blocks: [{ type: "tool_use", id, name, input: {} }],
});
const toolResult = (id: string): SessionEvent => ({
  type: "tool.result",
  toolUseId: id,
  content: "ok",
  isError: false,
});
const delta: SessionEvent = { type: "message.delta", text: "…" };

describe("activity clock: when a session last did something (issue #1478)", () => {
  test("any event, a streamed delta included, is the last activity", () => {
    const clock = new ActivityClock();
    expect(clock.lastEventAt("a")).toBeNull();
    clock.observe("a", delta, T0);
    clock.observe("a", delta, T0 + 5 * MIN);
    expect(clock.lastEventAt("a")).toBe(T0 + 5 * MIN);
    expect(clock.lastEventAt("b")).toBeNull();
  });

  test("a tool call is open from its use to its result, and the name stays after", () => {
    const clock = new ActivityClock();
    clock.observe("a", toolUse("t1", "Bash"), T0);
    expect(clock.tool("a")).toEqual({ name: "Bash", inFlight: true });
    clock.observe("a", toolResult("t1"), T0 + MIN);
    expect(clock.tool("a")).toEqual({ name: "Bash", inFlight: false });
  });

  test("two calls at once stay open until both have a result", () => {
    const clock = new ActivityClock();
    clock.observe("a", toolUse("t1", "Bash"), T0);
    clock.observe("a", toolUse("t2", "Read"), T0);
    clock.observe("a", toolResult("t1"), T0 + MIN);
    expect(clock.tool("a")).toEqual({ name: "Read", inFlight: true });
    clock.observe("a", toolResult("t2"), T0 + MIN);
    expect(clock.tool("a").inFlight).toBe(false);
  });

  test("the end of a turn closes a call that never got a result, and forget drops the session", () => {
    const clock = new ActivityClock();
    clock.observe("a", toolUse("t1", "Task"), T0);
    clock.observe(
      "a",
      { type: "turn.result", subtype: "success", isError: false, durationMs: 1 },
      T0 + MIN,
    );
    expect(clock.tool("a")).toEqual({ name: "Task", inFlight: false });
    clock.forget("a");
    expect(clock.lastEventAt("a")).toBeNull();
    expect(clock.tool("a")).toEqual({ name: null, inFlight: false });
  });
});

/** A clock, a timer and a host the test drives. */
function rig(minutes: number, status: SessionStatus = "running", unitMs?: number) {
  const state = {
    now: T0,
    intervals: new Map<number, () => unknown>(),
    periods: [] as number[],
    next: 1,
    status,
    listed: true,
  };
  const timers: StallTimers = {
    setInterval: ((fn: () => unknown, ms: number) => {
      const id = state.next++;
      state.intervals.set(id, fn);
      state.periods.push(ms);
      return id as unknown as ReturnType<typeof setInterval>;
    }) as never,
    clearInterval: ((id: number) => void state.intervals.delete(id)) as never,
  };
  const activity = new ActivityClock();
  const marks: Array<[string, QuietInfo | null]> = [];
  const host: StallHost = {
    list: () => (state.listed ? [{ id: "s1", status: state.status } as SessionSummary] : []),
    activity: (id) => ({ lastEventAt: activity.lastEventAt(id), tool: activity.tool(id) }),
    markQuiet: (id, info) => void marks.push([id, info]),
  };
  const watcher = new StallWatcher({
    host,
    minutes,
    now: () => state.now,
    timers,
    ...(unitMs === undefined ? {} : { unitMs }),
  });
  return { state, activity, marks, watcher };
}

describe("stall watcher: a running session that says nothing (issue #1478)", () => {
  test("quiet once N minutes pass with no event, with the time it went silent and its last tool", () => {
    const r = rig(15);
    r.activity.observe("s1", toolUse("t1", "Bash"), T0);
    r.activity.observe("s1", toolResult("t1"), T0 + MIN);
    r.state.now = T0 + MIN + 14 * MIN;
    expect(r.watcher.tick()).toEqual([]);
    expect(r.marks).toEqual([]);
    r.state.now = T0 + MIN + 15 * MIN;
    expect(r.watcher.tick()).toEqual(["s1"]);
    expect(r.marks).toEqual([["s1", { since: new Date(T0 + MIN).toISOString(), tool: "Bash" }]]);
  });

  test("a tool still running gets twice the time", () => {
    const r = rig(15);
    r.activity.observe("s1", toolUse("t1", "Bash"), T0);
    r.state.now = T0 + 29 * MIN;
    expect(r.watcher.tick()).toEqual([]);
    r.state.now = T0 + 30 * MIN;
    expect(r.watcher.tick()).toEqual(["s1"]);
  });

  test("it says so once per stall, not at every look", () => {
    const r = rig(10);
    r.activity.observe("s1", delta, T0);
    r.state.now = T0 + 10 * MIN;
    expect(r.watcher.tick()).toEqual(["s1"]);
    r.state.now = T0 + 20 * MIN;
    expect(r.watcher.tick()).toEqual([]);
    expect(r.marks).toHaveLength(1);
  });

  test("an event after the stall clears it, and a new silence can mark it again", () => {
    const r = rig(10);
    r.activity.observe("s1", delta, T0);
    r.state.now = T0 + 10 * MIN;
    r.watcher.tick();
    r.activity.observe("s1", delta, T0 + 11 * MIN);
    r.state.now = T0 + 12 * MIN;
    expect(r.watcher.tick()).toEqual([]);
    expect(r.marks.at(-1)).toEqual(["s1", null]);
    r.state.now = T0 + 21 * MIN;
    expect(r.watcher.tick()).toEqual(["s1"]);
    expect(r.marks.at(-1)?.[1]?.since).toBe(new Date(T0 + 11 * MIN).toISOString());
  });

  test("only a running session can be quiet: waiting on an approval, idle or never seen are not", () => {
    for (const status of ["awaiting_permission", "idle", "starting", "ended"] as const) {
      const r = rig(10, status);
      r.activity.observe("s1", delta, T0);
      r.state.now = T0 + 60 * MIN;
      expect(r.watcher.tick()).toEqual([]);
    }
    const unseen = rig(10);
    unseen.state.now = T0 + 60 * MIN;
    expect(unseen.watcher.tick()).toEqual([]);
    // The same silence on a running session that was seen is marked.
    const running = rig(10);
    running.activity.observe("s1", delta, T0);
    running.state.now = T0 + 60 * MIN;
    expect(running.watcher.tick()).toEqual(["s1"]);
  });

  test("a quiet session that starts waiting on an approval is no longer marked", () => {
    const r = rig(10);
    r.activity.observe("s1", delta, T0);
    r.state.now = T0 + 10 * MIN;
    r.watcher.tick();
    r.state.status = "awaiting_permission";
    r.state.now = T0 + 11 * MIN;
    expect(r.watcher.tick()).toEqual([]);
    expect(r.marks.at(-1)).toEqual(["s1", null]);
  });

  test("the demo counts the unit in seconds: 2 units of 1 s are 2 s", () => {
    const r = rig(2, "running", 1000);
    r.activity.observe("s1", delta, T0);
    r.state.now = T0 + 1900;
    expect(r.watcher.tick()).toEqual([]);
    r.state.now = T0 + 2000;
    expect(r.watcher.tick()).toEqual(["s1"]);
  });

  test("the timer's own callback is what looks, at a period that suits the unit", () => {
    const r = rig(10);
    r.activity.observe("s1", delta, T0);
    r.state.now = T0 + 10 * MIN;
    expect(r.marks).toEqual([]);
    for (const fire of r.state.intervals.values()) fire();
    expect(r.marks.map(([id]) => id)).toEqual(["s1"]);
    expect(r.state.periods).toEqual([30_000]);
    expect(rig(2, "running", 1000).state.periods).toEqual([500]);
    expect(rig(2, "running", 100).state.periods).toEqual([250]);
  });

  test("a session that leaves the list takes its mark with it, so a new one with that id can be marked", () => {
    const r = rig(10);
    r.activity.observe("s1", delta, T0);
    r.state.now = T0 + 10 * MIN;
    expect(r.watcher.tick()).toEqual(["s1"]);
    r.state.status = "ended";
    r.state.listed = false;
    expect(r.watcher.tick()).toEqual([]);
    r.state.listed = true;
    r.state.status = "running";
    expect(r.watcher.tick()).toEqual(["s1"]);
    expect(r.marks).toHaveLength(2);
  });

  test("0 is off: no timer at all, nothing marked, and turning it off clears what was marked", () => {
    const off = rig(0);
    expect(off.state.intervals.size).toBe(0);
    off.activity.observe("s1", delta, T0);
    off.state.now = T0 + 600 * MIN;
    expect(off.watcher.tick()).toEqual([]);

    const on = rig(10);
    expect(on.state.intervals.size).toBe(1);
    expect(on.watcher.minutes()).toBe(10);
    on.activity.observe("s1", delta, T0);
    on.state.now = T0 + 10 * MIN;
    on.watcher.tick();
    on.watcher.setMinutes(0);
    expect(on.state.intervals.size).toBe(0);
    expect(on.marks.at(-1)).toEqual(["s1", null]);
    on.watcher.setMinutes(5);
    expect(on.state.intervals.size).toBe(1);
    on.watcher.stop();
    expect(on.state.intervals.size).toBe(0);
  });
});
