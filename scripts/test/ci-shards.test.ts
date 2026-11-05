import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * #220: the Windows tests run in three shards and the prints apart from e2e, while the four checks
 * the main ruleset requires keep their exact names (an aggregate job each) and Linux keeps the
 * exact 100% coverage gate and SonarCloud.
 */
const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  name?: string;
  run?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string>;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string[];
  "runs-on"?: string;
  strategy?: { matrix?: Record<string, unknown[]> };
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

describe("ci-shards", () => {
  test("Linux runs the whole suite with the exact 100% gate and SonarCloud, on its own", () => {
    expect(job("test").strategy?.matrix?.os).toEqual(["ubuntu-latest"]);
    expect(runs("test")).toContain("bun run test");
    expect(job("test").steps.some((s) => s.name === "SonarCloud")).toBe(true);
  });

  test("Windows runs the tests in three shards, without coverage", () => {
    const shard = job("test-windows-shard");
    expect(shard["runs-on"]).toBe("windows-latest");
    expect(shard.strategy?.matrix?.shard).toEqual([1, 2, 3]);
    expect(runs("test-windows-shard")).toContain(
      "bun --config=bunfig.area.toml test --timeout=15000 --shard=${{ matrix.shard }}/3",
    );
    expect(runs("test-windows-shard")).not.toContain("bun run test");
  });

  test("the Windows smokes, cargo, bundle budget and performance baseline run in their own job", () => {
    const checks = runs("checks-windows");
    for (const command of [
      "bun run smoke:roi",
      "cargo test",
      "bun run bundle:budget",
      "bun run perf:baseline",
    ]) {
      expect(`${command}: ${checks.includes(command)}`).toBe(`${command}: true`);
    }
    expect(job("checks-windows").steps.some((s) => s.with?.name === "perf-baseline-windows")).toBe(
      true,
    );
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(job(key).steps.some((s) => s.name === "Git Bash para os hooks")).toBe(true);
    }
  });

  test("test (windows-latest) is one aggregate that fails unless every shard and the checks succeeded", () => {
    const gate = job("test-windows");
    expect(gate.name).toBe(`test (windows-latest)${SUFFIX}`);
    expect(gate.needs).toEqual(["changes", "test-windows-shard", "checks-windows"]);
    expect(gate.if).toBe(`always() && (${DISPATCH})`);
    const check = runs("test-windows");
    expect(check).toContain('test "${{ needs.test-windows-shard.result }}" = success');
    expect(check).toContain('test "${{ needs.checks-windows.result }}" = success');
  });

  test("screenshots (prints, axe e e2e) is one aggregate over the prints and the e2e jobs", () => {
    expect(runs("screenshots-prints")).toContain("bun run demo:shots");
    expect(runs("screenshots-e2e")).toContain("bun run e2e");
    const gate = job("screenshots");
    expect(gate.name).toBe("screenshots (prints, axe e e2e)");
    expect(gate.needs).toEqual(["changes", "screenshots-prints", "screenshots-e2e"]);
    expect(gate.if).toBe("always()");
    expect(runs("screenshots")).toContain(
      'test "${{ needs.screenshots-prints.result }}" = success',
    );
    expect(runs("screenshots")).toContain('test "${{ needs.screenshots-e2e.result }}" = success');
  });

  test("every test job skips a screenshots-only dispatch, and dispatched names never take a required name", () => {
    expect(job("test").if).toBe(DISPATCH);
    // The Windows jobs also wait for the path plan (#264).
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(`${key}: ${job(key).if}`).toBe(
        `${key}: (${DISPATCH}) && needs.changes.outputs.windows == 'true'`,
      );
    }
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(job(key).name ?? "").toEndWith(SUFFIX);
    }
  });
});
