import { describe, expect, test } from "bun:test";
import { PLOT, quotaPlot } from "../../src/features/costs/domain/quota-plot.ts";

const at = (hour: number) => `2026-11-21T${String(hour).padStart(2, "0")}:00:00.000Z`;
const left = PLOT.left;
const right = PLOT.width - PLOT.right;
const top = PLOT.top;
const bottom = PLOT.height - PLOT.bottom;

describe("the quota plot (#4430)", () => {
  test("time runs from the left edge of the plot to the right and 0% to 100% from its bottom to its top", () => {
    const { dots } = quotaPlot([
      { takenAt: at(10), utilization: 0 },
      { takenAt: at(11), utilization: 0.5 },
      { takenAt: at(12), utilization: 1 },
    ]);
    expect(dots.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: left, y: bottom },
      { x: (left + right) / 2, y: (top + bottom) / 2 },
      { x: right, y: top },
    ]);
  });

  test("one reading sits in the middle of the plot, with no line", () => {
    const { dots, segments } = quotaPlot([{ takenAt: at(10), utilization: 0.4 }]);
    expect(dots.map((p) => p.x)).toEqual([(left + right) / 2]);
    expect(segments.map((s) => s.length)).toEqual([1]);
  });

  test("readings taken at the same instant sit in the middle, not on the left edge", () => {
    const { dots } = quotaPlot([
      { takenAt: at(10), utilization: 0.2 },
      { takenAt: at(10), utilization: 0.4 },
    ]);
    expect(dots.map((p) => p.x)).toEqual([(left + right) / 2, (left + right) / 2]);
  });

  test("an unknown utilization has no dot and breaks the line", () => {
    const { dots, segments } = quotaPlot([
      { takenAt: at(10), utilization: 0.2 },
      { takenAt: at(11), utilization: null },
      { takenAt: at(12), utilization: 0.4 },
      { takenAt: at(13), utilization: 0.6 },
    ]);
    expect(dots.length).toBe(3);
    expect(segments.map((s) => s.length)).toEqual([1, 2]);
  });

  test("a utilization past 0% or 100% stays inside the frame", () => {
    const { dots } = quotaPlot([
      { takenAt: at(10), utilization: -0.1 },
      { takenAt: at(11), utilization: 1.2 },
    ]);
    expect(dots.map((p) => p.y)).toEqual([bottom, top]);
  });
});
