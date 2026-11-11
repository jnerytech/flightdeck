import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mergeShards } from "../../lib/shard-gate.ts";
import type { Tier } from "../../lib/test-tiers.ts";

const TIERS: Record<string, Tier> = { "a/u.test.ts": "unit", "b/i.test.ts": "integration" };
const MARKER = {
  shard: 1,
  of: 4,
  kind: "bun",
  files: ["a/u.test.ts"],
  exit: 0,
  fail: 0,
  tier: "unit + component 1/2",
  seconds: 12,
};
const JUNIT = `<testsuites><testsuite name="a/u.test.ts" file="a/u.test.ts" tests="3" time="0.5"></testsuite></testsuites>`;

/** The merge over one job folder, with the pyramid report recorded. */
function run(over: { junit?: string | null } = {}) {
  const reports: Array<{ markdown: string; json: string }> = [];
  const files = new Map<string, string>([
    [join("/art", "job-1", "marker.json"), JSON.stringify(MARKER)],
    [join("/art", "job-1", "lcov.info"), ""],
  ]);
  const junit = over.junit === undefined ? JUNIT : over.junit;
  if (junit !== null) files.set(join("/art", "job-1", "junit.xml"), junit);
  const code = mergeShards("/art", 4, "/out/lcov.info", {
    folders: () => ["job-1"],
    read: (path) => files.get(path) ?? null,
    write: () => {},
    tracked: ["a/u.test.ts", "b/i.test.ts"],
    sources: [],
    print: () => {},
    error: () => {},
    tiers: TIERS,
    pyramid: (markdown, json) => reports.push({ markdown, json }),
  });
  return { code, reports };
}

describe("shard-gate merge: the pyramid of the run goes to the job summary (#1854)", () => {
  test("the report is written even when the gate has no verdict, so a red run still shows its tiers", () => {
    const { code, reports } = run();
    expect(code).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.markdown).toContain("| unit | 1 | 3 | 0.5 s | a/u.test.ts (0.5 s) |");
    expect(reports[0]?.markdown).toContain("| unit + component 1/2 | 12.0 s |");
  });

  test("the JSON holds the same rows and jobs, for a chart of the trend", () => {
    const json = JSON.parse(run().reports[0]?.json ?? "{}");
    expect(json.rows.find((r: { tier: string }) => r.tier === "unit")).toMatchObject({
      files: 1,
      tests: 3,
      seconds: 0.5,
    });
    expect(json.jobs).toEqual([{ name: "unit + component 1/2", seconds: 12 }]);
  });

  test("a job with no JUnit file still reports its tiers, with the figures as none", () => {
    const row = JSON.parse(run({ junit: null }).reports[0]?.json ?? "{}").rows[0];
    expect(row).toMatchObject({ tier: "unit", files: 1, tests: null, seconds: null });
  });
});
