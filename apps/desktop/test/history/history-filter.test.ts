import { describe, expect, test } from "bun:test";
import { periodReversed } from "../../src/features/history/domain/history-filter.ts";

describe("periodReversed", () => {
  test("a first day after the last day is reversed", () => {
    expect(periodReversed({ from: "2026-11-10", to: "2026-11-01" })).toBe(true);
  });

  test("the same day, a forward period and an open end are not reversed", () => {
    expect([
      periodReversed({ from: "2026-11-01", to: "2026-11-01" }),
      periodReversed({ from: "2026-11-01", to: "2026-11-10" }),
      periodReversed({ from: "2026-11-01", to: "" }),
      periodReversed({ from: "", to: "2026-11-01" }),
    ]).toEqual([false, false, false, false]);
  });
});
