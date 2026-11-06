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
  jobs: Record<string, { if?: string; name?: string; needs?: string[]; steps: Step[] }>;
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

  test("on a PR the Windows shards run test:related's PR selection, the related integration and e2e tests included; on main, at night and by hand the whole suite (#309 b, #399)", () => {
    const shard = ci.jobs["test-windows-shard"]?.steps ?? [];
    const pr = shard.find(
      (s) => s.name === "Testes do PR (shard ${{ matrix.shard }}/3, seleção do test:related)",
    );
    const full = shard.find((s) => s.name === "Testes (shard ${{ matrix.shard }}/3)");
    expect(pr?.if).toBe("github.event_name == 'pull_request'");
    expect(pr?.env?.BASE_REF).toBe("${{ github.base_ref }}");
    expect(pr?.run).toBe(
      [
        'bun run test:related -- --pr --base "origin/$BASE_REF" --list selection.txt',
        "bun run test:shards -- run ${{ matrix.shard }}/3 --files selection.txt --junit junit-${{ matrix.shard }}.xml",
        "",
      ].join("\n"),
    );
    expect(full?.if).toBe("github.event_name != 'pull_request'");
    expect(full?.run).toBe(
      "bun run test:shards -- run ${{ matrix.shard }}/3 --junit junit-${{ matrix.shard }}.xml",
    );
  });

  test("the e2e journeys run when the plan asks for them: on a PR that changes the UI or the journeys, and always on main, nightly and by hand (#309 c, #399)", () => {
    expect(ci.jobs["screenshots-e2e"]?.if).toBe("needs.changes.outputs.e2e == 'true'");
  });

  test("the screenshots check needs the journeys green when they were planned, and skipped when not (#399)", () => {
    const check = (ci.jobs.screenshots?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(check).toContain('test "${{ needs.screenshots-prints.result }}" = success');
    expect(check).toContain('if [ "${{ needs.changes.outputs.e2e }}" = true ]; then');
    expect(check).toContain('test "${{ needs.screenshots-e2e.result }}" = success');
    expect(check).toContain('test "${{ needs.screenshots-e2e.result }}" = skipped');
    expect(check).not.toContain("github.event_name");
  });

  test("a failing journey gets Playwright's one retry and nothing more: no rerun in the workflow (#399)", () => {
    const e2e = ci.jobs["screenshots-e2e"];
    const run = (e2e?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(run).not.toMatch(/--retries|rerun|for attempt|until /);
    expect((e2e?.steps ?? []).some((s) => "continue-on-error" in s)).toBe(false);
  });

  test("the fast-coverage ratchet runs on PRs too, so a drop fails the PR, not main (#309 d, #358)", () => {
    const job = ci.jobs["fast-coverage"];
    expect(job?.name).toBe("fast coverage (ubuntu-latest)");
    expect(job?.needs).toEqual(["changes", "quick"]);
    expect(job?.if ?? "").not.toContain("pull_request");
    expect((job?.steps ?? []).some((s) => s.run === "bun run fast-coverage")).toBe(true);
  });

  test("the required test (ubuntu-latest) check waits for the fast-coverage ratchet and needs it green (#358)", () => {
    const aggregate = ci.jobs.test;
    expect(aggregate?.needs).toContain("fast-coverage");
    const check = (aggregate?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(check).toContain('test "${{ needs.fast-coverage.result }}" = success');
  });
});
