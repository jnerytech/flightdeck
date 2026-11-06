import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isCoverageSource } from "../lib/coverage-check.ts";
import {
  countsForCoverage,
  exclusionsOf,
  isTestFile,
  matchesGlob,
  testInclusionsOf,
} from "../lib/sonar-project.ts";

const ROOT = resolve(import.meta.dir, "../..");
const properties = readFileSync(resolve(ROOT, "sonar-project.properties"), "utf8");
const tracked = Bun.spawnSync(["git", "ls-files", "apps", "packages", "scripts"], {
  cwd: ROOT,
  stdout: "pipe",
})
  .stdout.toString()
  .split("\n")
  .filter((path) => /\.(?:tsx?|[cm]?js)$/.test(path));

describe("sonar-project.properties follows the local rules", () => {
  test("Sonar reads coverage of exactly the files the 100% gate covers", () => {
    const drift = tracked
      .filter((path) => countsForCoverage(path, properties) !== isCoverageSource(path))
      .map(
        (path) =>
          `${path}: Sonar ${countsForCoverage(path, properties) ? "counts" : "skips"} it, the gate ${
            isCoverageSource(path) ? "covers" : "skips"
          } it`,
      );
    expect(drift).toEqual([]);
  });

  test("every test file is analysed by Sonar as test code", () => {
    const inclusions = testInclusionsOf(properties);
    const excluded = exclusionsOf(properties);
    const tests = tracked.filter((path) => /\.test\.tsx?$|\/test\//.test(path));
    expect(tests.length).toBeGreaterThan(100);
    const missed = tests.filter(
      (path) => !isTestFile(path, inclusions) || excluded.some((glob) => matchesGlob(glob, path)),
    );
    expect(missed).toEqual([]);
  });

  test("source files are never taken for tests", () => {
    const inclusions = testInclusionsOf(properties);
    const wrong = tracked.filter((path) => isCoverageSource(path) && isTestFile(path, inclusions));
    expect(wrong).toEqual([]);
  });
});
