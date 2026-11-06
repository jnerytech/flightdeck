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
  test("the full suite runs every 3 hours on a schedule, so a red only it sees shows within 3 h (#444)", () => {
    expect(ci.on.schedule).toEqual([{ cron: "17 */3 * * *" }]);
  });

  test("a PR and a push to main run the fast tiers plus the related tests from the plan's base, gated per changed file, and keep the lcov for SonarCloud (#309, #444)", () => {
    const related = step("Testes da seleção (pirâmide)");
    expect(related?.if).toBe("needs.quick.outputs.base != ''");
    // The base reaches the shell as a quoted variable, never expanded into the line.
    expect(related?.env).toEqual({ BASE: "${{ needs.quick.outputs.base }}" });
    expect(related?.run).toBe(
      'bun run test:related -- --pr --base "$BASE" --keep-coverage coverage',
    );
  });

  test("the schedule and a run by hand run the whole suite with the 100% gate (#444)", () => {
    const full = step("Testes (cobertura 100%)");
    expect(full?.if).toBe("needs.quick.outputs.base == ''");
    expect(full?.run).toBe("bun run test");
  });

  test("the plan gives the selection's base: the PR's target, the commit a push to main came after, or none for a full run (#444)", () => {
    const plan = (ci.jobs.quick?.steps ?? []).find((s) => s.name === "The jobs this run needs");
    expect(plan?.env).toEqual({ BEFORE: "${{ github.event.before }}" });
    const outputs = (ci.jobs.quick as { outputs?: Record<string, string> } | undefined)?.outputs;
    expect(outputs?.base).toBe("${{ steps.plan.outputs.base }}");
  });

  test("on a PR the Windows shards run test:related's PR selection, the related integration and e2e tests included; on main, at night and by hand the whole suite (#309 b, #399)", () => {
    const shard = ci.jobs["test-windows-shard"]?.steps ?? [];
    const pr = shard.find(
      (s) =>
        s.name ===
        "Testes da seleção (shard ${{ matrix.shard }}/${{ strategy.job-total }}, test:related)",
    );
    const full = shard.find(
      (s) => s.name === "Testes (shard ${{ matrix.shard }}/${{ strategy.job-total }})",
    );
    expect(pr?.if).toBe("needs.quick.outputs.base != ''");
    expect(pr?.env?.BASE).toBe("${{ needs.quick.outputs.base }}");
    expect(pr?.run).toBe(
      [
        'bun run test:related -- --pr --base "$BASE" --list selection.txt',
        "bun run test:shards -- run ${{ matrix.shard }}/${{ strategy.job-total }} --files selection.txt --junit junit-${{ matrix.shard }}.xml",
        "",
      ].join("\n"),
    );
    expect(full?.if).toBe("needs.quick.outputs.base == ''");
    expect(full?.run).toBe(
      "bun run test:shards -- run ${{ matrix.shard }}/${{ strategy.job-total }} --junit junit-${{ matrix.shard }}.xml",
    );
  });

  test("the e2e journeys run when the plan asks for them: on a PR that changes the UI or the journeys, and always on main, nightly and by hand (#309 c, #399)", () => {
    expect(ci.jobs["screenshots-e2e"]?.if).toBe("needs.quick.outputs.e2e == 'true'");
  });

  test("the screenshots check needs the journeys green when they were planned, and skipped when not (#399)", () => {
    const check = (ci.jobs.screenshots?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(check).toContain('test "${{ needs.screenshots-prints.result }}" = success');
    expect(check).toContain('if [ "${{ needs.quick.outputs.e2e }}" = true ]; then');
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
    expect(job?.needs).toEqual(["quick"]);
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
