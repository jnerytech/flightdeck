import { describe, expect, test } from "bun:test";
import { localPyramid } from "../../lib/tests/pyramid-table.ts";
import type { Tier } from "../../lib/tests/test-tiers.ts";

// A local run ends with the same per-tier table as a PR's job summary (#1854 step 3).

const TIERS: Record<string, Tier> = {
  "a/u1.test.ts": "unit",
  "a/c1.test.tsx": "component",
  "b/i1.test.ts": "integration",
};

const junit = (suites: Array<[string, number, number]>) =>
  `<?xml version="1.0"?><testsuites>${suites
    .map(
      ([file, tests, time]) =>
        `<testsuite name="${file}" file="${file}" tests="${tests}" time="${time}"></testsuite>`,
    )
    .join("")}</testsuites>`;

describe("localPyramid: the table a local run prints at its end (#1854)", () => {
  test("a run's tiers get their tests, time and slowest file; a tier it did not run reads as none", () => {
    const table = localPyramid(
      TIERS,
      junit([
        ["a/u1.test.ts", 4, 1.5],
        ["a/c1.test.tsx", 2, 3],
      ]),
    );
    expect(table).toContain("| unit | 1 | 4 | 1.5 s | a/u1.test.ts (1.5 s) |");
    expect(table).toContain("| component | 1 | 2 | 3.0 s | a/c1.test.tsx (3.0 s) |");
    expect(table).toContain("| integration | 1 | – | – | – |");
  });

  test("a run that wrote no report, or one with no test file, prints no table", () => {
    expect(localPyramid(TIERS, null)).toBe("");
    expect(localPyramid(TIERS, junit([]))).toBe("");
  });

  test("a file of no known tier is left out, not counted as a unit test", () => {
    const table = localPyramid(TIERS, junit([["z/stray.test.ts", 9, 9]]));
    expect(table).toBe("");
  });
});
