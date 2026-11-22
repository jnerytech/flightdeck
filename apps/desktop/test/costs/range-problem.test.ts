import { describe, expect, test } from "bun:test";
import { daysBetween, rangeProblem } from "../../src/features/costs/domain/costs.ts";

describe("a custom range of days (#3896)", () => {
  test("an empty or reversed range is told apart from a good one", () => {
    expect(rangeProblem({ from: "2026-11-01", to: "2026-11-05" })).toBeNull();
    expect(rangeProblem({ from: "2026-11-05", to: "2026-11-05" })).toBeNull();
    expect(rangeProblem({ from: "", to: "2026-11-05" })).toBe("empty");
    expect(rangeProblem({ from: "2026-11-01", to: "" })).toBe("empty");
    expect(rangeProblem({ from: "2026-11-06", to: "2026-11-05" })).toBe("reversed");
  });

  test("a day that is not a day gives no days and never throws", () => {
    expect(() => daysBetween("", "2026-11-05")).not.toThrow();
    expect(daysBetween("", "2026-11-05").length).toBe(0);
    expect(daysBetween("2026-11-05", "").length).toBe(0);
    expect(daysBetween("2026-11-30", "2026-12-02")).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
  });
});
