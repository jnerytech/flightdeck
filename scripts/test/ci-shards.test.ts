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
  "continue-on-error"?: boolean;
  "runs-on"?: string;
  strategy?: { matrix?: Record<string, unknown> };
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
  test("Linux runs the whole suite with the exact 100% gate in its own job, and SonarCloud in another (#293)", () => {
    expect(job("test-suite")["runs-on"]).toBe("ubuntu-latest");
    expect(runs("test-suite")).toContain("bun run test");
    expect(job("test-suite").steps.some((s) => s.name === "SonarCloud")).toBe(false);
    expect(job("sonar").steps.some((s) => s.name === "SonarCloud")).toBe(true);
  });

  test("Windows runs the tests in three shards, without coverage", () => {
    const shard = job("test-windows-shard");
    expect(shard["runs-on"]).toBe("windows-latest");
    // One shard on a PR, three for the whole suite (#444): the plan says how many.
    expect(shard.strategy?.matrix?.shard).toBe(
      "${{ fromJSON(needs.quick.outputs.windows_shards) }}",
    );
    // Split by the seconds each test file took (scripts/test-timings.json), not by file count (#292).
    expect(runs("test-windows-shard")).toContain(
      "bun run test:shards -- run ${{ matrix.shard }}/${{ strategy.job-total }} --junit junit-${{ matrix.shard }}.xml",
    );
    expect(runs("test-windows-shard")).not.toContain("--shard=");
    // A long selection runs in batches, each with its own JUnit file (#483): the upload keeps them all.
    const upload = job("test-windows-shard").steps.find(
      (s) => s.name === "Publicar os tempos dos testes",
    );
    expect(upload?.with?.path).toBe("junit-${{ matrix.shard }}*.xml");
    expect(runs("test-windows-shard")).not.toMatch(/bun run test(\s|$)/);
  });

  test("the area config the shards run with skips the same paths as the full suite's (the mods run under claude plugin test)", () => {
    const ignored = (file: string) =>
      (
        Bun.TOML.parse(readFileSync(join(ROOT, file), "utf8")) as {
          test?: { pathIgnorePatterns?: string[] };
        }
      ).test?.pathIgnorePatterns ?? [];
    expect(ignored("bunfig.toml")).toContain("mods/**");
    expect(ignored("bunfig.area.toml")).toEqual(ignored("bunfig.toml"));
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
    expect(gate.needs).toEqual(["quick", "test-windows-shard", "checks-windows"]);
    expect(gate.if).toBe(`always() && (${DISPATCH})`);
    const check = runs("test-windows");
    expect(check).toContain('test "${{ needs.test-windows-shard.result }}" = success');
    expect(check).toContain('test "${{ needs.checks-windows.result }}" = success');
  });

  test("the Windows jobs are a signal in the full runs, never a gate (#534): a red one leaves the run green", () => {
    for (const key of ["test-windows-shard", "checks-windows", "test-windows"]) {
      expect(`${key}: ${job(key)["continue-on-error"]}`).toBe(`${key}: true`);
    }
    // Nothing that gates a release or a merge waits for them.
    for (const key of Object.keys(ci.jobs)) {
      if (key.includes("windows")) continue;
      expect(`${key}: ${(job(key).needs ?? []).filter((n) => n.includes("windows"))}`).toBe(
        `${key}: `,
      );
    }
  });

  test("screenshots (prints, axe e e2e) is one aggregate over the prints and the e2e jobs", () => {
    expect(runs("screenshots-prints")).toContain("bun run demo:shots");
    expect(runs("screenshots-e2e")).toContain("bun run e2e");
    const gate = job("screenshots");
    expect(gate.name).toBe("screenshots (prints, axe e e2e)");
    expect(gate.needs).toEqual(["quick", "screenshots-prints", "screenshots-e2e"]);
    expect(gate.if).toBe("always()");
    expect(runs("screenshots")).toContain(
      'test "${{ needs.screenshots-prints.result }}" = success',
    );
    expect(runs("screenshots")).toContain('test "${{ needs.screenshots-e2e.result }}" = success');
  });

  test("every test job skips a screenshots-only dispatch, and dispatched names never take a required name", () => {
    expect(job("test").if).toBe(`!cancelled() && (${DISPATCH})`);
    // The Windows jobs also wait for the path plan (#264).
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(`${key}: ${job(key).if}`).toBe(
        `${key}: (${DISPATCH}) && needs.quick.outputs.windows == 'true'`,
      );
    }
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(job(key).name ?? "").toEndWith(SUFFIX);
    }
  });
});
