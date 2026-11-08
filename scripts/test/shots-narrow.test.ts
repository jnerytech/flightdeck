import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NARROW_SHOTS, narrowSizes, unknownNarrowShots } from "../lib/shots-narrow.ts";

describe("shots-narrow: the narrow windows demo:shots re-measures (#641)", () => {
  test("a dark print in the list is re-measured at 1024x700, 640x800 and 390x844", () => {
    expect(narrowSizes("dark", "board").map(({ width, height }) => `${width}x${height}`)).toEqual([
      "1024x700",
      "640x800",
      "390x844",
    ]);
  });

  test("a light print, or a print not in the list, is not", () => {
    expect(narrowSizes("light", "board")).toHaveLength(0);
    expect(narrowSizes("dark", "paleta")).toHaveLength(0);
  });

  test("#677: a name in the list that is not a print is named, so a typo cannot skip one in silence", () => {
    expect(unknownNarrowShots([...NARROW_SHOTS])).toEqual([]);
    expect(unknownNarrowShots(NARROW_SHOTS.filter((name) => name !== "board"))).toEqual(["board"]);
    expect(unknownNarrowShots([])).toEqual([...NARROW_SHOTS]);
  });

  test("#762: demo:shots checks its own print names before Chrome starts, without the test importing it", () => {
    // Importing scripts/demo-shots.ts would count its untested browser code in the 100% gate.
    const source = readFileSync("scripts/demo-shots.ts", "utf8");
    const check = source.indexOf("unknownNarrowShots(shots(ids).map((shot) => shot.name))");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(source.indexOf("chromium.launch("));
  });
});
