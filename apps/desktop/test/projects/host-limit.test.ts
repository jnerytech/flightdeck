import { describe, expect, test } from "bun:test";
import { parseLimit } from "../../src/features/projects/domain/host-limit.ts";

// Issue #3924: what the Save limit button may send.
describe("parseLimit: the host limit as typed", () => {
  test("a whole number of at least 1 is the limit", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("12")).toBe(12);
    expect(parseLimit(" 4 ")).toBe(4);
  });

  test("empty, 0, negative, decimal, exponent and text are no limit, so an empty field never becomes 0", () => {
    for (const text of ["", " ", "0", "00", "-1", "2.5", "1e2", "+3", "abc", "3 4"]) {
      expect(parseLimit(text)).toBeNull();
    }
  });
});
