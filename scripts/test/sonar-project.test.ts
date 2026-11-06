import { describe, expect, test } from "bun:test";
import {
  countsForCoverage,
  exclusionsOf,
  isTestFile,
  matchesGlob,
  testInclusionsOf,
} from "../lib/sonar-project.ts";

describe("sonar-project: what sonar-project.properties tells SonarCloud (#283)", () => {
  const properties = [
    "sonar.sources=apps,packages,scripts",
    "sonar.exclusions=**/dist/**,apps/desktop/src/components/ui/**",
    "sonar.test.inclusions=**/test/**,**/*.test.ts,scripts/e2e/**",
    "sonar.coverage.exclusions=scripts/*.ts,**/*.d.ts",
  ].join("\n");

  test("the exclusions and the test inclusions come from the properties; a missing line is empty", () => {
    expect(exclusionsOf(properties)).toEqual(["**/dist/**", "apps/desktop/src/components/ui/**"]);
    expect(testInclusionsOf(properties)).toEqual(["**/test/**", "**/*.test.ts", "scripts/e2e/**"]);
    expect(exclusionsOf("sonar.sources=apps")).toEqual([]);
    expect(testInclusionsOf("sonar.sources=apps")).toEqual([]);
  });

  test("** crosses folders, a single * stops at a slash, and dots are literal", () => {
    expect(matchesGlob("**/test/**", "apps/daemon/test/a.ts")).toBe(true);
    expect(matchesGlob("**/*.test.ts", "board.test.ts")).toBe(true);
    expect(matchesGlob("scripts/*.ts", "scripts/slot.ts")).toBe(true);
    expect(matchesGlob("scripts/*.ts", "scripts/lib/slot.ts")).toBe(false);
    expect(matchesGlob("**/*.d.ts", "apps/daemon/src/xd.ts")).toBe(false);
  });

  test("a file matching an inclusion is test code, the rest is source", () => {
    const inclusions = testInclusionsOf(properties);
    expect(isTestFile("apps/daemon/test/board.test.ts", inclusions)).toBe(true);
    expect(isTestFile("apps/daemon/test/helper.ts", inclusions)).toBe(true);
    expect(isTestFile("scripts/e2e/journeys.ts", inclusions)).toBe(true);
    expect(isTestFile("apps/daemon/src/board/board.ts", inclusions)).toBe(false);
  });

  test("coverage counts analysed source files only", () => {
    expect(countsForCoverage("apps/daemon/src/board/board.ts", properties)).toBe(true);
    expect(countsForCoverage("scripts/lib/slot.ts", properties)).toBe(true);
    expect(countsForCoverage("scripts/slot.ts", properties)).toBe(false);
    expect(countsForCoverage("apps/daemon/src/text-modules.d.ts", properties)).toBe(false);
    expect(countsForCoverage("apps/daemon/test/board.test.ts", properties)).toBe(false);
    expect(countsForCoverage("apps/desktop/src/components/ui/button.tsx", properties)).toBe(false);
    expect(countsForCoverage("packages/protocol/dist/index.ts", properties)).toBe(false);
  });
});
