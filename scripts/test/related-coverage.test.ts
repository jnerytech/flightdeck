import { describe, expect, test } from "bun:test";
import {
  checkChanged,
  coverageTargets,
  isCoverageSource,
  lineRanges,
} from "../lib/related-coverage.ts";
import { planRelated } from "../lib/test-related.ts";

/** An lcov record the way Bun writes it: totals and one DA line per executable line. */
const record = (file: string, fn: [number, number], lines: Array<[number, number]>) =>
  [
    `SF:${file}`,
    `FNF:${fn[1]}`,
    `FNH:${fn[0]}`,
    ...lines.map(([line, hits]) => `DA:${line},${hits}`),
    `LF:${lines.length}`,
    `LH:${lines.filter(([, hits]) => hits > 0).length}`,
    "end_of_record",
  ].join("\n");

describe("related-coverage: which changed files the rule covers", () => {
  test("sources of the packages, the apps and scripts/lib count", () => {
    for (const path of [
      "apps/daemon/src/board/board.ts",
      "apps/desktop/src/ui/Card.tsx",
      "packages/protocol/src/index.ts",
      "scripts/lib/test-related.ts",
    ]) {
      expect(isCoverageSource(path)).toBe(true);
    }
  });

  test("tests, declarations, entry points, the vendored ui and other scripts do not", () => {
    for (const path of [
      "apps/daemon/test/board.test.ts",
      "apps/desktop/src/types.d.ts",
      "apps/daemon/src/bin.ts",
      "apps/desktop/src/main.tsx",
      "apps/desktop/src/main.web.tsx",
      "apps/desktop/src/components/ui/button.tsx",
      "scripts/demo-seed.ts",
      "scripts/test-related.ts",
      "docs/TDD.md",
      "apps/desktop/src/i18n/en.json",
    ]) {
      expect(isCoverageSource(path)).toBe(false);
    }
  });

  test("a deleted file and a type-only module are not targets", () => {
    const files: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/src/types.ts": "export type A = { a: number };",
    };
    expect(
      coverageTargets(
        ["apps/daemon/src/a.ts", "apps/daemon/src/types.ts", "apps/daemon/src/gone.ts"],
        (path) => files[path] ?? null,
      ),
    ).toEqual(["apps/daemon/src/a.ts"]);
  });
});

describe("related-coverage: the lines of a gap", () => {
  test("consecutive lines read as a range", () => {
    expect(lineRanges([1, 2, 3, 5, 8, 9])).toBe("1-3, 5, 8-9");
    expect(lineRanges([7])).toBe("7");
    expect(lineRanges([])).toBe("");
  });
});

describe("related-coverage: the verdict on the changed files", () => {
  const lcov = [
    record(
      "apps/daemon/src/full.ts",
      [2, 2],
      [
        [1, 1],
        [2, 3],
      ],
    ),
    record(
      "apps/daemon/src/low.ts",
      [1, 2],
      [
        [1, 1],
        [20, 0],
        [21, 0],
        [22, 0],
        [30, 0],
      ],
    ),
    record("apps/daemon/src/untouched.ts", [0, 1], [[1, 0]]),
  ].join("\n");

  test("a changed file at 100% passes", () => {
    expect(checkChanged(lcov, ["apps/daemon/src/full.ts"])).toEqual({
      problems: [],
      functionGaps: [],
    });
  });

  test("a changed file below 100% fails with its uncovered lines and its function count", () => {
    expect(checkChanged(lcov, ["apps/daemon/src/low.ts"])).toEqual({
      problems: ["apps/daemon/src/low.ts: lines 20-22, 30 not covered; functions 1/2 called"],
      functionGaps: ["apps/daemon/src/low.ts"],
    });
  });

  test("an unchanged file below 100% is ignored", () => {
    expect(checkChanged(lcov, ["apps/daemon/src/full.ts"]).problems).toEqual([]);
  });

  test("a changed file the related tests never load is a failure of its own", () => {
    expect(checkChanged(lcov, ["apps/daemon/src/new.ts"])).toEqual({
      problems: ["apps/daemon/src/new.ts: no related test loads this file"],
      functionGaps: [],
    });
  });

  test("functions only: the lines are all covered but a function never runs", () => {
    const only = record("apps/daemon/src/fn.ts", [1, 2], [[1, 1]]);
    expect(checkChanged(only, ["apps/daemon/src/fn.ts"])).toEqual({
      problems: ["apps/daemon/src/fn.ts: functions 1/2 called"],
      functionGaps: ["apps/daemon/src/fn.ts"],
    });
  });
});

describe("related-coverage: the plan of test:related with coverage", () => {
  const files: Record<string, string> = {
    "apps/daemon/src/a.ts": "export const a = 1;",
    "apps/daemon/src/b.ts": "export const b = 2;",
    "apps/daemon/test/a.test.ts": `import "../src/a.ts";`,
  };
  const git = (changed: string[]) => (args: string[]) => {
    if (args[0] === "merge-base") return "abc1234def\n";
    if (args[0] === "diff") return changed.join("\n");
    if (args[0] === "ls-files") return Object.keys(files).join("\n");
    return null;
  };
  const plan = (changed: string[], coverageDir?: string) =>
    planRelated({
      platform: "linux",
      git: git(changed),
      readFile: (path) => files[path] ?? "",
      ...(coverageDir ? { coverageDir } : {}),
    });

  test("with a coverage dir the run collects an lcov report there and names the targets", () => {
    const result = plan(["apps/daemon/src/a.ts"], "/tmp/cov");
    expect(result.command).toEqual([
      "bun",
      "--config=bunfig.area.toml",
      "test",
      "--timeout=15000",
      "--coverage",
      "--coverage-reporter=lcov",
      "--coverage-dir=/tmp/cov",
      "./apps/daemon/test/a.test.ts",
    ]);
    expect(result.targets).toEqual(["apps/daemon/src/a.ts"]);
  });

  test("a changed source no test reaches fails at once, before any run", () => {
    const result = plan(["apps/daemon/src/b.ts"], "/tmp/cov");
    expect(result.code).toBe(1);
    expect(result.command).toBeNull();
    expect(result.output).toContain("apps/daemon/src/b.ts: no related test loads this file");
  });

  test("without a coverage dir the plan is the one it always was", () => {
    const result = plan(["apps/daemon/src/a.ts"]);
    expect(result.command).not.toContain("--coverage");
    expect(result.targets).toBeUndefined();
  });
});
