import { describe, expect, test } from "bun:test";
import {
  CACHE_TIMER_KEY,
  CACHE_TTL_KEY,
  CacheTimerSettings,
  cacheTimer,
  clockText,
  SharedClock,
  spokenParts,
} from "../src/lib/cache-timer.ts";
import type { Platform } from "../src/platform/types.ts";

const FIVE = 300_000;
const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const after = (ms: number) => T0 + ms;

describe("cache-timer: where the prompt cache stands (issue #159)", () => {
  test("m:ss, rounded up to the second", () => {
    expect(clockText(300_000)).toBe("5:00");
    expect(clockText(130_000)).toBe("2:10");
    expect(clockText(59_001)).toBe("1:00");
    expect(clockText(59_000)).toBe("0:59");
    expect(clockText(1)).toBe("0:01");
    expect(clockText(3_600_000)).toBe("60:00");
  });

  test("the turn just ended: 5:00 and warm", () => {
    expect(cacheTimer(new Date(T0).toISOString(), after(0), FIVE)).toEqual({
      phase: "warm",
      remainingMs: FIVE,
      text: "5:00",
    });
  });

  test("the last 59 seconds are the warning, 0:59 included", () => {
    const since = new Date(T0).toISOString();
    expect(cacheTimer(since, after(FIVE - 60_000), FIVE)).toMatchObject({
      phase: "warm",
      text: "1:00",
    });
    expect(cacheTimer(since, after(FIVE - 59_000), FIVE)).toMatchObject({
      phase: "warning",
      text: "0:59",
    });
    expect(cacheTimer(since, after(FIVE - 1_000), FIVE)).toMatchObject({
      phase: "warning",
      text: "0:01",
    });
  });

  test("at 0:00 it is cold: no number, and it stays cold", () => {
    const since = new Date(T0).toISOString();
    expect(cacheTimer(since, after(FIVE), FIVE)).toEqual({
      phase: "cold",
      remainingMs: 0,
      text: "",
    });
    expect(cacheTimer(since, after(HOUR * 5), FIVE)).toMatchObject({ phase: "cold" });
  });

  test("the hour lifetime counts from 60:00", () => {
    expect(cacheTimer(new Date(T0).toISOString(), after(1_000), HOUR)).toMatchObject({
      phase: "warm",
      text: "59:59",
    });
  });

  test("with no moment, or one that is not a date, it is not known", () => {
    expect(cacheTimer(null, after(0), FIVE)).toBeNull();
    expect(cacheTimer(undefined, after(0), FIVE)).toBeNull();
    expect(cacheTimer("later", after(0), FIVE)).toBeNull();
  });

  test("a moment in the future (clock skew) counts as just ended", () => {
    expect(cacheTimer(new Date(after(10_000)).toISOString(), after(0), FIVE)).toMatchObject({
      phase: "warm",
      text: "5:00",
    });
  });

  test("the spoken form splits minutes and seconds", () => {
    expect(spokenParts(130_000)).toEqual({ minutes: 2, seconds: 10 });
    expect(spokenParts(59_001)).toEqual({ minutes: 1, seconds: 0 });
    expect(spokenParts(5_000)).toEqual({ minutes: 0, seconds: 5 });
  });
});

/** A clock whose timers and visibility the test drives. */
function fakeWorld() {
  const world = {
    nowMs: T0,
    hidden: false,
    timers: new Set<() => void>(),
    started: 0,
    watchers: new Set<() => void>(),
  };
  const clock = new SharedClock({
    now: () => world.nowMs,
    every: (fn) => {
      world.started++;
      world.timers.add(fn);
      return () => world.timers.delete(fn);
    },
    hidden: () => world.hidden,
    onVisibility: (fn) => {
      world.watchers.add(fn);
      return () => world.watchers.delete(fn);
    },
  });
  const tick = () => {
    for (const fn of [...world.timers]) fn();
  };
  const setHidden = (hidden: boolean) => {
    world.hidden = hidden;
    for (const fn of [...world.watchers]) fn();
  };
  return { world, clock, tick, setHidden };
}

describe("cache-timer: one shared clock (issue #159)", () => {
  test("nothing runs until someone listens; the first listener starts one timer for all", () => {
    const { world, clock, tick } = fakeWorld();
    expect(world.timers.size).toBe(0);
    let a = 0;
    let b = 0;
    const offA = clock.subscribe(() => a++);
    const offB = clock.subscribe(() => b++);
    expect(world.started).toBe(1);
    tick();
    expect([a, b]).toEqual([1, 1]);
    offA();
    tick();
    expect([a, b]).toEqual([1, 2]);
    offB();
    expect(world.timers.size).toBe(0);
    expect(world.watchers.size).toBe(0);
  });

  test("it reports the current time", () => {
    const { world, clock } = fakeWorld();
    world.nowMs = after(5_000);
    expect(clock.now()).toBe(after(5_000));
  });

  test("hidden window: the timer is stopped; shown again, it restarts and tells at once", () => {
    const { world, clock, setHidden } = fakeWorld();
    let told = 0;
    clock.subscribe(() => told++);
    setHidden(true);
    expect(world.timers.size).toBe(0);
    expect(told).toBe(0);
    setHidden(false);
    expect(world.timers.size).toBe(1);
    expect(told).toBe(1);
  });

  test("listening while the window is hidden starts nothing until it is shown", () => {
    const { world, clock, setHidden } = fakeWorld();
    world.hidden = true;
    clock.subscribe(() => {});
    expect(world.timers.size).toBe(0);
    setHidden(false);
    expect(world.timers.size).toBe(1);
  });

  test("a second visibility event in the same state does not start a second timer", () => {
    const { world, clock, setHidden } = fakeWorld();
    clock.subscribe(() => {});
    setHidden(false);
    setHidden(false);
    expect(world.timers.size).toBe(1);
    expect(world.started).toBe(1);
  });
});

describe("cache-timer: the settings (issue #159)", () => {
  const storage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      data,
    };
  };
  const make = (initial?: Record<string, string>) => {
    const kept = storage(initial);
    return { kept, settings: new CacheTimerSettings(kept as unknown as Platform["storage"]) };
  };

  test("off by default, with the 5 minute lifetime", () => {
    const { settings } = make();
    expect(settings.enabled).toBe(false);
    expect(settings.ttl).toBe(FIVE);
  });

  test("what was chosen comes back; anything else falls to the defaults", () => {
    const { settings } = make({ [CACHE_TIMER_KEY]: "on", [CACHE_TTL_KEY]: String(HOUR) });
    expect(settings.enabled).toBe(true);
    expect(settings.ttl).toBe(HOUR);
    const odd = make({ [CACHE_TIMER_KEY]: "maybe", [CACHE_TTL_KEY]: "42" }).settings;
    expect(odd.enabled).toBe(false);
    expect(odd.ttl).toBe(FIVE);
  });

  test("changing either keeps it and tells the listeners at once", () => {
    const { kept, settings } = make();
    let told = 0;
    settings.subscribe(() => told++);
    settings.setEnabled(true);
    settings.setTtl(HOUR);
    expect(settings.enabled).toBe(true);
    expect(settings.ttl).toBe(HOUR);
    expect(kept.data.get(CACHE_TIMER_KEY)).toBe("on");
    expect(kept.data.get(CACHE_TTL_KEY)).toBe(String(HOUR));
    expect(told).toBe(2);
    settings.setEnabled(false);
    expect(kept.data.get(CACHE_TIMER_KEY)).toBe("off");
  });
});
