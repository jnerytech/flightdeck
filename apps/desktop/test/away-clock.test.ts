import { describe, expect, test } from "bun:test";
import { AWAY_KEY, AWAY_MIN_MS, AwayClock } from "../src/features/needs-you/away.ts";

/** Issue #1344: the time the app was last active, read before this start writes its own. */
const NOW = Date.parse("2026-11-09T08:00:00.000Z");

function storage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(AWAY_KEY, initial);
  return {
    items,
    api: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    },
  };
}

describe("away-clock (#1344)", () => {
  test("an absence of the minimum or more gives the time it began; a shorter one gives nothing", () => {
    const long = new Date(NOW - AWAY_MIN_MS).toISOString();
    const short = new Date(NOW - AWAY_MIN_MS + 1).toISOString();
    expect([
      new AwayClock(storage(long).api, () => NOW).since(),
      new AwayClock(storage(short).api, () => NOW).since(),
    ]).toEqual([long, null]);
  });

  test("the very first start has no earlier time, so nothing is summarised", () => {
    const clock = new AwayClock(storage().api, () => NOW);
    expect([clock.previous, clock.since()]).toEqual([null, null]);
  });

  test("a value that is not a time is ignored", () => {
    expect(new AwayClock(storage("last night").api, () => NOW).since()).toBeNull();
  });

  test("marking writes now, and the time read at the start does not move", () => {
    const early = new Date(NOW - 2 * 3_600_000).toISOString();
    const kept = storage(early);
    const clock = new AwayClock(kept.api, () => NOW);
    clock.mark();
    expect([kept.items.get(AWAY_KEY), clock.since(), clock.previous]).toEqual([
      new Date(NOW).toISOString(),
      early,
      early,
    ]);
  });

  test("a storage that throws leaves the app working with no summary", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const clock = new AwayClock(broken, () => NOW);
    clock.mark();
    expect(clock.since()).toBeNull();
  });
});
