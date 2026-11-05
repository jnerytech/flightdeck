import { afterEach, describe, expect, test } from "bun:test";
import { IdleSleeper, type SleeperTimers } from "../src/sessions/sleeper.ts";
import { newManager, poll, record } from "./helpers.ts";

const MIN = 60_000;

/** A clock and a timer the test drives. */
function clock() {
  const state = {
    now: Date.parse("2026-11-05T12:00:00Z"),
    intervals: new Map<number, () => unknown>(),
    next: 1,
  };
  const timers: SleeperTimers = {
    setInterval: ((fn: () => unknown) => {
      const id = state.next++;
      state.intervals.set(id, fn);
      return id as unknown as ReturnType<typeof setInterval>;
    }) as never,
    clearInterval: ((id: number) => void state.intervals.delete(id)) as never,
  };
  return { state, timers, now: () => state.now };
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function idleSession(over: Parameters<typeof newManager>[0] = {}) {
  const ctx = newManager(over);
  const { sessionId } = await ctx.manager.create({ cwd: ctx.project, prompt: "hello" });
  await poll(() => ctx.manager.get(sessionId).status === "idle");
  return { ...ctx, sessionId };
}

describe("sleeper: an idle session gives back its process (issue #157)", () => {
  test("sleeping closes the process, keeps the session idle and asleep, and logs why", async () => {
    const { manager, sessionId } = await idleSession();
    const rec = record(manager, sessionId);
    expect(manager.get(sessionId).asleep).toBe(false);
    expect(await manager.sleep(sessionId)).toBe("slept");
    expect(manager.get(sessionId)).toMatchObject({ status: "idle", asleep: true });
    expect(manager.list().find((s) => s.id === sessionId)?.asleep).toBe(true);
    const slept = rec.find("session.status").filter((e) => e.reason === "slept");
    expect(slept).toHaveLength(1);
    expect(await manager.sleep(sessionId)).toBe("already");
  });

  test("a message wakes it: the process starts again from the Claude session id and the turn is answered", async () => {
    const { manager, runtime, sessionId } = await idleSession();
    const claudeId = manager.get(sessionId).claudeSessionId;
    expect(claudeId).not.toBeNull();
    await manager.sleep(sessionId);
    expect(runtime.starts).toHaveLength(1);
    const rec = record(manager, sessionId);
    const before = rec.count("message.assistant");
    expect(manager.send(sessionId, "are you there?")).toEqual({ queued: false });
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]?.resume).toBe(claudeId as string);
    await poll(() => rec.count("message.assistant") > before);
    await poll(() => manager.get(sessionId).status === "idle");
    expect(rec.count("message.assistant")).toBeGreaterThan(before);
    expect(manager.get(sessionId).asleep).toBe(false);
  });

  test("a running session, one asking for permission and an ended one do not sleep", async () => {
    const ctx = newManager();
    const run = await ctx.manager.create({ cwd: ctx.project, prompt: "hello" });
    await poll(() => ctx.manager.get(run.sessionId).status === "idle");
    ctx.manager.send(run.sessionId, "[bash]");
    await poll(() => ctx.manager.get(run.sessionId).status === "awaiting_permission");
    expect(await ctx.manager.sleep(run.sessionId)).toBe("not_idle");
    const ended = await ctx.manager.create({ cwd: ctx.project, prompt: "hello" });
    await poll(() => ctx.manager.get(ended.sessionId).status === "idle");
    await ctx.manager.close(ended.sessionId);
    expect(await ctx.manager.sleep(ended.sessionId)).toBe("not_idle");
  });

  test("a session someone is subscribed to does not sleep by itself, but does when asked to", async () => {
    const { manager, sessionId } = await idleSession();
    const rec = record(manager, sessionId);
    expect(await manager.sleep(sessionId)).toBe("subscribed");
    expect(await manager.sleep(sessionId, { manual: true })).toBe("slept");
    rec.unsubscribe();
  });

  test("what the host wants awake (a pinned session, a card's) is never put to sleep, not even by hand", async () => {
    const { manager, sessionId } = await idleSession({ keepAwake: () => true });
    expect(await manager.sleep(sessionId)).toBe("kept_awake");
    expect(await manager.sleep(sessionId, { manual: true })).toBe("kept_awake");
    expect(manager.get(sessionId).asleep).toBe(false);
  });
});

describe("sleeper: after N minutes", () => {
  test("with the setting off the daemon holds no timer", () => {
    const c = clock();
    const { manager } = newManager();
    const sleeper = new IdleSleeper({ manager, minutes: 0, now: c.now, timers: c.timers });
    expect(c.state.intervals.size).toBe(0);
    expect(sleeper.minutes()).toBe(0);
    sleeper.setMinutes(10);
    expect(c.state.intervals.size).toBe(1);
    sleeper.setMinutes(0);
    expect(c.state.intervals.size).toBe(0);
    sleeper.setMinutes(5);
    sleeper.stop();
    expect(c.state.intervals.size).toBe(0);
  });

  test("an idle session unwatched for a minute sleeps; a younger one, a running one and a watched one do not", async () => {
    const c = clock();
    const ctx = newManager();
    const make = async (prompt: string) => {
      const s = await ctx.manager.create({ cwd: ctx.project, prompt });
      await poll(() => ctx.manager.get(s.sessionId).status === "idle");
      return s.sessionId;
    };
    const old = await make("old");
    const watched = await make("watched");
    const rec = record(ctx.manager, watched);
    const running = await make("running");
    ctx.manager.send(running, "[bash]");
    await poll(() => ctx.manager.get(running).status === "awaiting_permission");
    // The sessions went idle "now" by the real clock; the sleeper's clock is a minute and a bit later.
    const sleeper = new IdleSleeper({
      manager: ctx.manager,
      minutes: 1,
      now: () => Date.now() + MIN + 5_000,
      timers: c.timers,
    });
    cleanups.push(() => sleeper.stop());
    expect((await sleeper.tick()).sort()).toEqual([old]);
    expect(ctx.manager.get(old).asleep).toBe(true);
    expect(ctx.manager.get(watched).asleep).toBe(false);
    expect(ctx.manager.get(running).asleep).toBe(false);
    rec.unsubscribe();
    // Thirty seconds is not a minute.
    const young = new IdleSleeper({
      manager: ctx.manager,
      minutes: 1,
      now: () => Date.now() + 30_000,
      timers: c.timers,
    });
    expect(await young.tick()).toEqual([]);
  });

  test("the timer ticks the sleeper, and a session already asleep is not slept twice", async () => {
    const c = clock();
    const ctx = newManager();
    const s = await ctx.manager.create({ cwd: ctx.project, prompt: "x" });
    await poll(() => ctx.manager.get(s.sessionId).status === "idle");
    const sleeper = new IdleSleeper({
      manager: ctx.manager,
      minutes: 1,
      now: () => Date.now() + 2 * MIN,
      timers: c.timers,
    });
    sleeper.setMinutes(1);
    for (const fn of c.state.intervals.values()) await fn();
    expect(ctx.manager.get(s.sessionId).asleep).toBe(true);
    expect(await sleeper.tick()).toEqual([]);
  });
});
