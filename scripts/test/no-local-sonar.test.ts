import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

describe("no-local-sonar: SonarCloud Code Analysis on the PR is the only Sonar check (#283)", () => {
  test("the local Sonar linter, its rule profile, its baseline and its library are gone", () => {
    for (const path of [
      "tools/sonar-lint",
      "scripts/lib/sonar-lint.ts",
      "scripts/sonar-profile.json",
      "sonar-baseline.json",
    ]) {
      expect(`${path}: ${existsSync(join(ROOT, path))}`).toBe(`${path}: false`);
    }
  });

  test("the package has no lint:sonar script and no tools workspace, and the lockfile no sonarjs plugin", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      workspaces: string[];
    };
    expect(pkg.scripts["lint:sonar"]).toBeUndefined();
    expect(pkg.workspaces).not.toContain("tools/*");
    expect(readFileSync(join(ROOT, "bun.lock"), "utf8")).not.toContain("eslint-plugin-sonarjs");
  });

  test("CLAUDE.md no longer tells a session to run lint:sonar", () => {
    expect(readFileSync(join(ROOT, "CLAUDE.md"), "utf8")).not.toContain("lint:sonar");
  });
});
