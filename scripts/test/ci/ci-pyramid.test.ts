import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** #309: a PR runs the cheap base of the test pyramid; the full suite runs on main and every night. */
const ROOT = resolve(import.meta.dir, "../../..");

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
const merge = () => step("Testes (cobertura 80%, 4 shards)");

describe("ci-pyramid (#309)", () => {
  test("#1003: after the merge, the slow-test check reads each shard's JUnit times, and fails if any file does", () => {
    const check = step("Testes lentos (#1003)");
    expect(check?.if).toBe("always() && needs.quick.outputs.base != ''");
    // A report missing after a passing merge is a failure, not a pass (#1022 review).
    expect(check?.env).toEqual({ TESTS_OUTCOME: "${{ steps.merge.outcome }}" });
    expect(check?.run).toContain("for report in");
    expect(check?.run).toContain('"$RUNNER_TEMP"/shards/shard-*-bun/junit.xml');
    expect(check?.run).toContain('bun run scripts/slow-tests.ts "$report" || status=1');
    expect(check?.run).toContain("exit $status");
    expect((merge() as { id?: string } | undefined)?.id).toBe("merge");
  });

  test("the full suite runs every 3 hours on a schedule, so a red only it sees shows within 3 h (#444)", () => {
    expect(ci.on.schedule).toEqual([{ cron: "17 */3 * * *" }]);
  });

  test("a PR and a push to main shard the fast tiers plus the related tests from the plan's base, merged and gated per changed file, and keep the lcov for SonarCloud (#309, #444, #1761)", () => {
    // The base reaches the shell as a quoted variable, never expanded into the line.
    expect(merge()?.env).toEqual({ BASE: "${{ needs.quick.outputs.base }}" });
    expect(merge()?.run).toBe(
      'bun run scripts/shard-gate.ts merge "$RUNNER_TEMP/shards" 4 coverage/lcov.info ${BASE:+--base "$BASE"}',
    );
    // The same steps merge a full run (no base): the selection is the whole suite then.
    expect(merge()?.if).toBeUndefined();
    const download = step("Relatórios dos shards");
    expect(download?.if).toBeUndefined();
    expect((download as { "continue-on-error"?: boolean })?.["continue-on-error"]).toBe(true);
    expect((download as { with?: Record<string, string> })?.with).toEqual({
      pattern: "shard-*",
      path: "${{ runner.temp }}/shards",
    });
    // The single-runner steps of before are gone: the shards run the tests, istanbul included.
    expect(steps.map((s) => s.name)).not.toContain("Testes da seleção (pirâmide)");
    expect(steps.map((s) => s.name)).not.toContain("Changed tests under istanbul (#1493)");
  });

  test("each shard runs twice, Bun's coverage and istanbul's functions, on a PR, a push and a full run (#296, #1761)", () => {
    const shard = ci.jobs["test-shard"] as
      | { if?: string; name?: string; needs?: string[]; strategy?: unknown; steps: Step[] }
      | undefined;
    expect(shard?.if).toBe(
      "github.event_name != 'workflow_dispatch' || inputs.only != 'screenshots'",
    );
    expect(shard?.needs).toEqual(["quick"]);
    expect(shard?.strategy).toEqual({
      "fail-fast": false,
      matrix: {
        shard: [1, 2, 3, 4],
        kind: ["bun", "istanbul"],
        include: [
          { shard: 1, tier: "unit + component", part: "1/2" },
          { shard: 2, tier: "unit + component", part: "2/2" },
          { shard: 3, tier: "integration", part: "1/2" },
          { shard: 4, tier: "integration", part: "2/2" },
        ],
      },
    });
    expect(shard?.name).toBe(
      "${{ matrix.tier }} ${{ matrix.part }} ${{ matrix.kind }} (ubuntu-latest)${{ github.event_name == 'workflow_dispatch' && ' (dispatch)' || '' }}",
    );
    // The shards never use the token after checkout (#828 review).
    const checkout = shard?.steps.find((s) =>
      ((s as { uses?: string }).uses ?? "").startsWith("actions/checkout@"),
    ) as { with?: Record<string, unknown> } | undefined;
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    const run = shard?.steps.find((s) => (s.run ?? "").includes("shard-gate.ts run"));
    // Outside the checkout: the repo guard fails a test run that leaves a file in it.
    expect(run?.run).toBe(
      'bun run scripts/shard-gate.ts run ${{ matrix.shard }}/4 ${{ matrix.kind }} "$RUNNER_TEMP/shard" ${BASE:+--base "$BASE"}',
    );
    expect(run?.env).toEqual({ BASE: "${{ needs.quick.outputs.base }}" });
    const upload = shard?.steps.find((s) =>
      ((s as { uses?: string }).uses ?? "").startsWith("actions/upload-artifact@"),
    ) as { if?: string; with?: Record<string, unknown> } | undefined;
    expect(upload?.if).toBe("always()");
    expect(upload?.with).toEqual({
      name: "shard-${{ matrix.shard }}-${{ matrix.kind }}",
      path: "${{ runner.temp }}/shard",
      "retention-days": 1,
    });
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
    // It reads the unit + component shards' coverage from the suite's merge, not a third run of
    // those tests (#1854): no checkout, no install, seconds instead of minutes.
    expect(job?.needs).toEqual(["quick", "test-suite"]);
    expect(job?.if ?? "").not.toContain("pull_request");
    expect(job?.if ?? "").toContain("!cancelled()");
    const run = (job?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(run).toContain('test "${{ needs.test-suite.outputs.fast }}" = pass');
    expect(run).not.toContain("bun run fast-coverage");
    expect((job?.steps ?? []).some((s) => (s as { uses?: string }).uses)).toBe(false);
    const merge = (ci.jobs["test-suite"]?.steps ?? []).find((s) => s.id === "merge");
    expect(merge).toBeDefined();
    expect(
      (ci.jobs["test-suite"] as { outputs?: Record<string, string> } | undefined)?.outputs?.fast,
    ).toBe("${{ steps.merge.outputs.fast }}");
  });

  test("the required test (ubuntu-latest) check waits for the fast-coverage ratchet and needs it green (#358)", () => {
    const aggregate = ci.jobs.test;
    expect(aggregate?.needs).toContain("fast-coverage");
    const check = (aggregate?.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(check).toContain('test "${{ needs.fast-coverage.result }}" = success');
  });
});
