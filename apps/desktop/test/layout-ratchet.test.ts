import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initialised,
  type LayoutBaseline,
  overBaseline,
  screenCounts,
  tightened,
} from "../../../scripts/lib/layout-ratchet.ts";

const DESKTOP = resolve(import.meta.dir, "..");
const SCREENS = resolve(DESKTOP, "src/ui");
const BASELINE = resolve(DESKTOP, "layout-baseline.json");

const baseline = (): LayoutBaseline =>
  existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as LayoutBaseline) : {};

describe("layout-ratchet: the count of raw layout utilities per screen only goes down", () => {
  test("a file over its baseline is reported with both numbers; a new file may hold none", () => {
    expect(
      overBaseline({ "a.tsx": 5, "b.tsx": 2, "c.tsx": 1 }, { "a.tsx": 5, "b.tsx": 3 }),
    ).toEqual(["c.tsx: 1 > 0"]);
    expect(overBaseline({ "a.tsx": 6 }, { "a.tsx": 5 })).toEqual(["a.tsx: 6 > 5"]);
    expect(overBaseline({ "a.tsx": 5 }, { "a.tsx": 5 })).toEqual([]);
  });

  test("tightening lowers a count, drops a file at zero and never raises or admits a file", () => {
    expect(
      tightened({ "a.tsx": 3, "b.tsx": 9, "d.tsx": 4 }, { "a.tsx": 5, "b.tsx": 7, "c.tsx": 2 }),
    ).toEqual({ "a.tsx": 3, "b.tsx": 7 });
  });

  test("--init writes the counts only into an empty baseline; with entries it is refused and nothing is raised", () => {
    expect(initialised({ "a.tsx": 5 }, {})).toEqual({ "a.tsx": 5 });
    expect(initialised({ "a.tsx": 9 }, { "a.tsx": 5 })).toBeNull();
    expect(initialised({ "a.tsx": 1 }, { "b.tsx": 2 })).toBeNull();
  });

  test("no screen holds more raw layout utilities than the committed baseline", () => {
    expect(overBaseline(screenCounts(SCREENS, DESKTOP), baseline())).toEqual([]);
  });

  test("the baseline has no entry for a file that is gone or at zero (run layout:ratchet after a migration)", () => {
    const counts = screenCounts(SCREENS, DESKTOP);
    const stale = Object.keys(baseline()).filter((file) => !counts[file]);
    expect(stale).toEqual([]);
  });
});
