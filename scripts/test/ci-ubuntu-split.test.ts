import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * #293: the Linux leg no longer runs the suite, SonarCloud, the smokes and cargo one after another
 * in one job. The suite, SonarCloud and the checks are jobs of their own, and the required check
 * `test (ubuntu-latest)` is an aggregate over them, so the main ruleset stays as it is.
 */
const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  name?: string;
  run?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string[];
  "runs-on"?: string;
  steps: Step[];
}
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};
const job = (key: string): Job => ci.jobs[key] ?? { steps: [] };
const runs = (key: string) =>
  job(key)
    .steps.map((s) => s.run ?? "")
    .join("\n");
const DISPATCH = "github.event_name != 'workflow_dispatch' || inputs.only != 'screenshots'";
const SUFFIX = "${{ github.event_name == 'workflow_dispatch' && ' (dispatch)' || '' }}";
const PINNED = /@[0-9a-f]{40}$/;

describe("ci-ubuntu-split (#293)", () => {
  test("the suite runs alone, after quick, and hands its lcov report on as an artifact", () => {
    const suite = job("test-suite");
    expect(suite.name).toBe(`test suite (ubuntu-latest)${SUFFIX}`);
    expect(suite.needs).toEqual(["changes", "quick"]);
    expect(suite.if).toBe(DISPATCH);
    expect(runs("test-suite")).toContain("bun run test");
    for (const gone of ["Smokes", "SonarCloud", "cargo check do app"]) {
      expect(`${gone}: ${suite.steps.some((s) => s.name === gone)}`).toBe(`${gone}: false`);
    }
    const upload = suite.steps.find((s) => (s.uses ?? "").startsWith("actions/upload-artifact@"));
    expect(upload?.uses ?? "").toMatch(PINNED);
    // Paths and line counts only, read once by the sonar job: kept a day, not the default 90.
    expect(upload?.with).toEqual({
      name: "coverage-lcov",
      path: "coverage/lcov.info",
      "retention-days": 1,
    });
  });

  test("SonarCloud is its own job, reading the suite's lcov, with the history it blames", () => {
    const sonar = job("sonar");
    expect(sonar.needs).toEqual(["test-suite"]);
    expect(sonar.if ?? "").toContain("github.event_name != 'workflow_dispatch'");
    // Full history for the blame; no GITHUB_TOKEN left in .git/config for the third-party scan.
    expect(sonar.steps[0]?.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
    const download = sonar.steps.findIndex((s) =>
      (s.uses ?? "").startsWith("actions/download-artifact@"),
    );
    const scan = sonar.steps.findIndex((s) => s.name === "SonarCloud");
    expect(download >= 0 && download < scan).toBe(true);
    expect(sonar.steps[download]?.uses ?? "").toMatch(PINNED);
    expect(sonar.steps[download]?.with).toEqual({ name: "coverage-lcov", path: "coverage" });
    // The version comes from a file the branch controls: only a plain version reaches $GITHUB_ENV.
    const version = sonar.steps.find((s) => s.name === "Versão para o SonarCloud")?.run ?? "";
    expect(version).toContain('[[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]]');
  });

  test("the smokes and cargo run in a Linux checks job, in parallel with the suite", () => {
    const checks = job("checks-linux");
    expect(checks.name).toBe(`checks (ubuntu-latest)${SUFFIX}`);
    expect(checks.needs).toEqual(["changes", "quick"]);
    expect(runs("checks-linux")).toContain("bun run smoke");
    expect(runs("checks-linux")).toContain("cargo check");
  });

  test("test (ubuntu-latest) is an aggregate that fails unless changes, quick, the suite, SonarCloud and the checks succeeded", () => {
    const gate = job("test");
    expect(gate.name).toBe(`test (ubuntu-latest)${SUFFIX}`);
    expect(gate.needs).toEqual(["changes", "quick", "test-suite", "sonar", "checks-linux"]);
    expect(gate.if).toBe(`!cancelled() && (${DISPATCH})`);
    const check = runs("test");
    // The plan and the quick job first: a failure there must fail the check, never skip it.
    const quick = check.indexOf('test "${{ needs.quick.result }}" = success');
    expect(check.indexOf('test "${{ needs.changes.result }}" = success')).toBeLessThan(quick);
    expect(quick).toBeLessThan(check.indexOf("needs.test-suite.result"));
    expect(check).toContain('test "${{ needs.test-suite.result }}" = success');
    // SonarCloud skips on a dispatch; the checks skip only when the plan needs no smoke or cargo.
    expect(check).toContain('case "${{ needs.sonar.result }}" in success|skipped)');
    expect(check).toContain('test "${{ needs.checks-linux.result }}" = success');
    expect(check).toContain("needs.changes.outputs.smokes");
    expect(check).toContain("needs.changes.outputs.cargo");
  });
});
