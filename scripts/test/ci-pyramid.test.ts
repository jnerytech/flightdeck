import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** #309: a PR runs the cheap base of the test pyramid; the full suite runs on main and every night. */
const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
}
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  on: { schedule?: { cron: string }[] };
  jobs: Record<string, { steps: Step[] }>;
};
const steps = ci.jobs["test-suite"]?.steps ?? [];
const step = (name: string) => steps.find((s) => s.name === name);

describe("ci-pyramid (#309)", () => {
  test("the full suite also runs every night, on a schedule", () => {
    expect(ci.on.schedule).toEqual([{ cron: "17 4 * * *" }]);
  });

  test("on a PR the suite job runs the fast tiers plus the related tests, gated per changed file, and keeps the lcov for SonarCloud", () => {
    const pr = step("Testes do PR (pirâmide)");
    expect(pr?.if).toBe("github.event_name == 'pull_request'");
    // The base branch reaches the shell as a quoted variable, never expanded into the line.
    expect(pr?.env).toEqual({ BASE_REF: "${{ github.base_ref }}" });
    expect(pr?.run).toBe(
      'bun run test:related -- --pr --base "origin/$BASE_REF" --keep-coverage coverage',
    );
  });

  test("on main, at night and by hand the suite job runs the whole suite with the 100% gate", () => {
    const full = step("Testes (cobertura 100%)");
    expect(full?.if).toBe("github.event_name != 'pull_request'");
    expect(full?.run).toBe("bun run test");
  });

  test("the e2e journeys leave the PR path: they run on main, nightly and by hand (#309 c)", () => {
    expect(ci.jobs["screenshots-e2e"]?.if).toBe(
      "needs.changes.outputs.screenshots == 'true' && github.event_name != 'pull_request'",
    );
  });

  test("the screenshots check accepts skipped journeys on a PR only; elsewhere they must pass (#309 c)", () => {
    const check = (ci.jobs.screenshots?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(check).toContain('test "${{ needs.screenshots-prints.result }}" = success');
    expect(check).toContain('if [ "${{ github.event_name }}" = pull_request ]; then');
    expect(check).toContain('test "${{ needs.screenshots-e2e.result }}" = skipped');
    expect(check).toContain('test "${{ needs.screenshots-e2e.result }}" = success');
  });
});
