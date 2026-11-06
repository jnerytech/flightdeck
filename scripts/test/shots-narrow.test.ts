import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  test("every name in the list is a print of demo:shots, so a typo cannot skip one in silence", () => {
    const source = readFileSync(join(import.meta.dir, "../demo-shots.ts"), "utf8");
    // A print is `{ name: "<x>", route: ... }`; a route has `name` too, but no `route` after it.
    const missing = NARROW_SHOTS.filter(
      (name) => !new RegExp(`name: "${name}",\\s*route:`).test(source),
    );
    expect(NARROW_SHOTS.length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
