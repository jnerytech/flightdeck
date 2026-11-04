import { describe, expect, test } from "bun:test";
import type { QuotaState } from "@flightdeck/protocol";
import { quotaGlance, shortDuration } from "../src/lib/status-bar.ts";

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

const window = (name: string, utilization: number | null, resetsIn: number | null) => ({
  window: name,
  utilization,
  status: "allowed" as const,
  resetsAt: resetsIn === null ? null : at(resetsIn),
  readAt: at(0),
});
const state = (...windows: ReturnType<typeof window>[]): QuotaState => ({
  windows,
  pauseAt: null,
});

describe("status-bar", () => {
  test("the time left is the two largest units", () => {
    expect(shortDuration(3 * DAY + 9 * HOUR + 20 * MIN)).toBe("3d 9h");
    expect(shortDuration(3 * HOUR + 47 * MIN)).toBe("3h 47m");
    expect(shortDuration(12 * MIN + 30_000)).toBe("12m");
    expect(shortDuration(40_000)).toBe("0m");
    expect(shortDuration(-5 * MIN)).toBe("0m");
  });

  test("the glance is the most used window of the online hosts, with its time to reset", () => {
    const quota = {
      a: state(window("five_hour", 0.14, 3 * HOUR), window("seven_day", 0.78, 3 * DAY + 9 * HOUR)),
      b: state(window("five_hour", 0.4, HOUR)),
      off: state(window("seven_day", 0.99, DAY)),
    };
    expect(quotaGlance(quota, ["a", "b"], NOW)).toEqual({
      window: "seven_day",
      percent: 78,
      remaining: "3d 9h",
    });
  });

  test("windows with no reading, and hosts with none, give no glance; a window without a reset has no time", () => {
    expect(quotaGlance({}, ["a"], NOW)).toBeNull();
    expect(quotaGlance({ a: state(window("five_hour", null, HOUR)) }, ["a"], NOW)).toBeNull();
    expect(quotaGlance({ a: state(window("five_hour", 0.5, null)) }, ["a"], NOW)).toEqual({
      window: "five_hour",
      percent: 50,
      remaining: "",
    });
  });
});
