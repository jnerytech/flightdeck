import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { overBaseline } from "../../lib/layout-ratchet.ts";
import { flatTestCounts } from "../../lib/test-layout.ts";

// repo-wide (#1108): reads every tracked path, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../../..");

describe("test-layout (#1610)", () => {
  test("a test file directly in a workspace's test folder is flat; one in a domain folder is not", () => {
    expect(
      flatTestCounts([
        "apps/desktop/test/a.test.ts",
        "apps/desktop/test/b.test.tsx",
        "apps/desktop/test/hosts/c.test.ts",
        "packages/protocol/test/d.test.ts",
        "scripts/test/e.test.ts",
        "scripts/test/guards/f.test.ts",
      ]),
    ).toEqual({ "apps/desktop/test": 2, "packages/protocol/test": 1, "scripts/test": 1 });
  });

  test("helpers, fixtures and source files in the test folder are not counted", () => {
    expect(
      flatTestCounts([
        "apps/desktop/test/dom.ts",
        "apps/desktop/test/fixtures.json",
        "apps/desktop/test/preload.test.d.ts",
        "apps/desktop/src/test/x.test.ts",
        "docs/test/y.test.ts",
      ]),
    ).toEqual({});
  });

  test("a workspace over its baseline, or missing from it, fails the ratchet", () => {
    const counts = { "apps/desktop/test": 12, "packages/protocol/test": 3 };
    expect(overBaseline(counts, { "apps/desktop/test": 10 })).toEqual([
      "apps/desktop/test: 12 > 10",
      "packages/protocol/test: 3 > 0",
    ]);
  });

  test("no workspace has more flat test files than test-layout-baseline.json allows", () => {
    const paths = spawnSync("git", ["ls-files", "apps", "packages", "scripts"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout.split("\n");
    expect(paths.length).toBeGreaterThan(500);
    const counts = flatTestCounts(paths);
    const baseline = JSON.parse(readFileSync(join(ROOT, "test-layout-baseline.json"), "utf8"));
    expect(overBaseline(counts, baseline)).toEqual([]);
  });
});
