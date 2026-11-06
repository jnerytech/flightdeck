import { describe, expect, test } from "bun:test";
import type { QuotaState } from "@flightdeck/protocol";
import { quotaGlance, shortDuration } from "../src/lib/quota-glance.ts";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const at = (ms: number) => new Date(NOW + ms).toISOString();
const reading = (window: string, utilization: number | null, resetsIn: number | null) => ({
  window,
  utilization,
  status: "allowed" as const,
  resetsAt: resetsIn === null ? null : at(resetsIn),
  readAt: at(0),
});
const state = (...windows: ReturnType<typeof reading>[]): QuotaState => ({
  windows,
  pauseAt: null,
});

describe("quota-glance: the plan window under most pressure, for the top bar (issue #118)", () => {
  test("the most used window across the online hosts, with its host and the time left", () => {
    const glance = quotaGlance(
      {
        a: state(reading("five_hour", 0.2, 3_600_000), reading("seven_day", 0.35, 86_400_000)),
        b: state(reading("five_hour", 0.62, 2 * 3_600_000 + 47 * 60_000)),
      },
      ["a", "b"],
      NOW,
    );
    expect(glance).toEqual({
      hostId: "b",
      window: "five_hour",
      percent: 62,
      remaining: "2h 47m",
      level: "ok",
    });
  });

  test("a host that is not online is left out, and with no reading there is no glance", () => {
    const quota = { a: state(reading("five_hour", 0.9, 60_000)) };
    expect(quotaGlance(quota, [], NOW)).toBeNull();
    expect(quotaGlance({ a: state(reading("five_hour", null, null)) }, ["a"], NOW)).toBeNull();
  });

  test("from 80% the level is near, at 100% it is reached: the words go with the colour", () => {
    const level = (u: number) =>
      quotaGlance({ a: state(reading("seven_day", u, null)) }, ["a"], NOW)?.level;
    expect([level(0.79), level(0.8), level(0.99), level(1)]).toEqual([
      "ok",
      "near",
      "near",
      "reached",
    ]);
    expect(quotaGlance({ a: state(reading("seven_day", 0.5, null)) }, ["a"], NOW)?.remaining).toBe(
      "",
    );
  });

  test("the time left is its two largest units, and what has passed is 0m", () => {
    expect(shortDuration(3 * 86_400_000 + 9 * 3_600_000 + 5 * 60_000)).toBe("3d 9h");
    expect(shortDuration(3 * 3_600_000 + 47 * 60_000)).toBe("3h 47m");
    expect(shortDuration(12 * 60_000)).toBe("12m");
    expect(shortDuration(-5000)).toBe("0m");
  });
});
