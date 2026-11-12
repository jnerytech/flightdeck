import { describe, expect, test } from "bun:test";
import { pyramidOf, renderPyramid } from "../../lib/tests/pyramid-table.ts";
import type { ShardMarker } from "../../lib/tests/shard-gate.ts";
import type { Tier } from "../../lib/tests/test-tiers.ts";

const TIERS: Record<string, Tier> = {
  "a/u1.test.ts": "unit",
  "a/u2.test.ts": "unit",
  "a/c1.test.tsx": "component",
  "b/i1.test.ts": "integration",
  "b/i2.test.ts": "integration",
  "scripts/e2e/j1.e2e.ts": "e2e",
  "scripts/e2e/j2.e2e.ts": "e2e",
};

/** A bun JUnit file: one suite per test file, with its test count and seconds. */
const junit = (suites: Array<[string, number, number]>) =>
  `<?xml version="1.0"?><testsuites>${suites
    .map(
      ([file, tests, time]) =>
        `<testsuite name="${file}" file="${file}" tests="${tests}" time="${time}"><testcase name="t" classname="x"/></testsuite>` +
        `<testsuite name="describe" file="${file}" line="3" tests="1" time="9"></testsuite>`,
    )
    .join("")}</testsuites>`;

const job = (over: Partial<ShardMarker>, xml: string | null) => ({
  marker: { shard: 1, of: 4, kind: "bun", files: [], exit: 0, fail: 0, ...over } as ShardMarker,
  junit: xml,
});

const JOBS = [
  job(
    {
      shard: 1,
      tier: "unit + component 1/2",
      files: ["a/u1.test.ts", "a/c1.test.tsx"],
      seconds: 40,
    },
    junit([
      ["a/u1.test.ts", 10, 1.5],
      ["a/c1.test.tsx", 20, 8],
    ]),
  ),
  job(
    { shard: 2, tier: "unit + component 2/2", files: ["a/u2.test.ts"], seconds: 30 },
    junit([["a/u2.test.ts", 5, 0.5]]),
  ),
  job(
    { shard: 3, tier: "integration 1/2", files: ["b/i1.test.ts", "b/i2.test.ts"], seconds: 120 },
    junit([
      ["b/i1.test.ts", 7, 60],
      ["b/i2.test.ts", 3, 30],
    ]),
  ),
  // The istanbul twin ran the same files: it is not counted twice.
  { marker: { ...JOBS_ISTANBUL() }, junit: null },
];
function JOBS_ISTANBUL(): ShardMarker {
  return { shard: 1, of: 4, kind: "istanbul", files: ["a/u1.test.ts"], exit: 0, fail: 0 };
}

describe("pyramid table: tests, files, time and slowest file per tier (#1854)", () => {
  const rows = pyramidOf(TIERS, JOBS);
  const row = (tier: Tier) => rows.rows.find((r) => r.tier === tier);

  test("a row per tier in pyramid order, with the files the tree holds", () => {
    expect(rows.rows.map((r) => [r.tier, r.files])).toEqual([
      ["unit", 2],
      ["component", 1],
      ["integration", 2],
      ["e2e", 2],
    ]);
  });

  test("tests and seconds are summed over the tier's files, from the bun jobs' JUnit only", () => {
    expect(row("unit")).toMatchObject({ tests: 15, seconds: 2 });
    expect(row("component")).toMatchObject({ tests: 20, seconds: 8 });
    expect(row("integration")).toMatchObject({ tests: 10, seconds: 90 });
  });

  test("the slowest file of each tier is named with its seconds", () => {
    expect(row("unit")?.slowest).toEqual({ file: "a/u1.test.ts", seconds: 1.5 });
    expect(row("integration")?.slowest).toEqual({ file: "b/i1.test.ts", seconds: 60 });
  });

  test("a tier the jobs did not run (a PR selection) reads as none, never as zero seconds of a run", () => {
    const only = pyramidOf(TIERS, [JOBS[0] as (typeof JOBS)[number]]);
    expect(only.rows.find((r) => r.tier === "integration")).toMatchObject({
      tests: null,
      seconds: null,
      slowest: null,
    });
  });

  test("the jobs list each tier group's wall time, in the order the plan runs them", () => {
    expect(rows.jobs).toEqual([
      { name: "unit + component 1/2", seconds: 40 },
      { name: "unit + component 2/2", seconds: 30 },
      { name: "integration 1/2", seconds: 120 },
    ]);
  });

  test("the markdown has one line per tier and the slowest file; a missing figure is a dash", () => {
    const md = renderPyramid(rows);
    expect(md).toContain("| unit | 2 | 15 | 2.0 s | a/u1.test.ts (1.5 s) |");
    expect(md).toContain("| integration | 2 | 10 | 90.0 s | b/i1.test.ts (60.0 s) |");
    expect(md).toContain("| e2e | 2 | – | – | – |");
  });
});
