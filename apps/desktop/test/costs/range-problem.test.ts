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

  test("a year still being typed or a day the calendar lacks is not a day", () => {
    // A date input emits 0002-11-22 while the year 2026 is typed: it must not ask for 2000 years of days.
    expect(rangeProblem({ from: "0002-11-22", to: "2026-11-05" })).toBe("empty");
    expect(rangeProblem({ from: "0202-11-22", to: "2026-11-05" })).toBe("empty");
    expect(rangeProblem({ from: "2026-02-31", to: "2026-11-05" })).toBe("empty");
    expect(daysBetween("0002-11-22", "2026-11-05").length).toBe(0);
    expect(daysBetween("2026-02-31", "2026-03-05").length).toBe(0);
    expect(rangeProblem({ from: "2024-02-29", to: "2026-11-05" })).toBeNull();
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
