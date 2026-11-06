import { describe, expect, test } from "bun:test";
import { shotNames } from "../demo-shots.ts";
import { NARROW_SHOTS, narrowSizes } from "../lib/shots-narrow.ts";

describe("shots-narrow: the narrow windows demo:shots re-measures (#641)", () => {
  test("a dark print in the list is re-measured at 1024x700, 640x800 and 390x844", () => {
    expect(narrowSizes("dark", "board").map(({ width, height }) => `${width}x${height}`)).toEqual([
      "1024x700",
      "640x800",
      "390x844",
    ]);
  });

  test("a light print, or a print not in the list, is not", () => {
    expect(narrowSizes("light", "board").length).toBe(0);
    expect(narrowSizes("dark", "paleta").length).toBe(0);
  });

  test("#677: every name in the list is a print of demo:shots, so a typo cannot skip one in silence", () => {
    const prints = shotNames();
    expect(prints.length).toBeGreaterThan(40);
    expect(NARROW_SHOTS.filter((name) => !prints.includes(name))).toEqual([]);
  });
});
