import { describe, expect, test } from "bun:test";
import { luminance, themeProblem } from "../lib/print-theme.ts";

describe("luminance", () => {
  test("black is 0 and white is 1", () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  test("a dark gray is far darker than a light gray", () => {
    expect(luminance([20, 20, 24])).toBeLessThan(0.02);
    expect(luminance([240, 240, 240])).toBeGreaterThan(0.8);
  });
});

describe("themeProblem", () => {
  test("a dark print on a light background is a problem that names the print", () => {
    const line = themeProblem("dark", "dark en paleta", [255, 255, 255]);
    expect(line).toContain("dark en paleta");
    expect(line).toContain("light");
  });

  test("a light print on a dark background is a problem too", () => {
    expect(themeProblem("light", "light en board", [10, 10, 12])).toContain("light en board");
  });

  test("matching prints are fine", () => {
    expect(themeProblem("dark", "dark en paleta", [12, 12, 16])).toBeNull();
    expect(themeProblem("light", "light en paleta", [250, 250, 250])).toBeNull();
  });
});
