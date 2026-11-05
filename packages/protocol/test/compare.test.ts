import { describe, expect, test } from "bun:test";
import { byCodeUnit } from "../src/compare.ts";

const MIXED = ["beta", "Alpha", "alpha", "Zulu", "_x", "10", "9", "é", "e", "Éa"];

describe("compare: byCodeUnit", () => {
  test("orders exactly as a bare sort does, so existing keys do not change", () => {
    expect([...MIXED].sort(byCodeUnit)).toEqual([...MIXED].sort());
  });

  test("a key joined from the sorted list is the same before and after, for mixed-case input", () => {
    const before = [...MIXED].sort().join("|");
    expect([...MIXED].sort(byCodeUnit).join("|")).toBe(before);
    expect(before.startsWith("10|9|Alpha|Zulu|_x|alpha")).toBe(true);
  });

  test("a locale order is not the same, which is why keys must not use it", () => {
    expect([...MIXED].sort((a, b) => a.localeCompare(b, "en")).join("|")).not.toBe(
      [...MIXED].sort().join("|"),
    );
  });

  test("equal strings compare as 0, smaller as negative, larger as positive", () => {
    expect(byCodeUnit("a", "a")).toBe(0);
    expect(byCodeUnit("a", "b")).toBeLessThan(0);
    expect(byCodeUnit("b", "a")).toBeGreaterThan(0);
  });
});
