import { describe, expect, test } from "bun:test";
import {
  coverageSummary,
  latestFullRun,
  parseCoverageSummary,
} from "../../lib/metrics/coverage.ts";

/** Issue #1949 (task 2): whole-repo coverage in the snapshot. */

const lcov = (files: Array<[string, number, number, number, number]>) =>
  files
    .map(
      ([path, lh, lf, fnh, fnf]) =>
        `SF:${path}\nFNF:${fnf}\nFNH:${fnh}\nLF:${lf}\nLH:${lh}\nend_of_record`,
    )
    .join("\n");

describe("metrics: coverage totals", () => {
  test("the line and function percent over the source files the gate covers, no test or vendored file", () => {
    const text = lcov([
      ["apps/daemon/src/a.ts", 80, 100, 8, 10],
      ["packages/protocol/src/b.ts", 20, 100, 2, 10],
      ["apps/daemon/test/a.test.ts", 100, 100, 10, 10],
      ["apps/desktop/src/components/ui/button.tsx", 0, 500, 0, 50],
    ]);
    expect(coverageSummary(text)).toEqual({
      linesPercent: 50,
      functionsPercent: 50,
      lines: { hit: 100, found: 200 },
      functions: { hit: 10, found: 20 },
    });
  });

  test("an lcov with nothing to cover has null percent, never zero", () => {
    expect(coverageSummary("")).toEqual({
      linesPercent: null,
      functionsPercent: null,
      lines: { hit: 0, found: 0 },
      functions: { hit: 0, found: 0 },
    });
  });

  test("the summary file reads back, and anything else is refused", () => {
    const summary = coverageSummary(lcov([["apps/daemon/src/a.ts", 1, 2, 1, 2]]));
    expect(parseCoverageSummary(JSON.stringify(summary))).toEqual(summary);
    expect(parseCoverageSummary("not json")).toBeNull();
    expect(parseCoverageSummary('{"linesPercent":"x"}')).toBeNull();
  });
});

describe("metrics: the run coverage is read from", () => {
  test("the latest scheduled or dispatched run, never a pull request or a push", () => {
    const runs = [
      { databaseId: 5, event: "push", createdAt: "2026-11-10T10:00:00Z" },
      { databaseId: 4, event: "schedule", createdAt: "2026-11-10T09:00:00Z" },
      { databaseId: 3, event: "workflow_dispatch", createdAt: "2026-11-10T11:00:00Z" },
      { databaseId: 2, event: "pull_request", createdAt: "2026-11-10T12:00:00Z" },
    ];
    expect(latestFullRun(runs)).toBe(3);
    expect(latestFullRun(runs.filter((r) => r.event === "push"))).toBeNull();
    expect(latestFullRun([])).toBeNull();
  });
});
