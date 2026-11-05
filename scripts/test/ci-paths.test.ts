import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ciPlan, FULL, planOutputs } from "../lib/ci-paths.ts";

/**
 * #264: a pull request runs only the jobs its paths need; main, a run by hand and a diff that
 * cannot be read run everything; a job skipped by path still reports under the ruleset's name.
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
  outputs?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown[]> };
  steps: Step[];
}
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};
const job = (key: string): Job => ci.jobs[key] ?? { steps: [] };
const step = (key: string, name: string) => job(key).steps.find((s) => s.name === name);
const runs = (key: string) =>
  job(key)
    .steps.map((s) => s.run ?? "")
    .join("\n");
const gate = (output: string) => `needs.changes.outputs.${output} == 'true'`;
const PR = "pull_request";
const NONE = { windows: false, smokes: false, screenshots: false, cargo: false };

describe("ci-paths: the rules", () => {
  test("docs or scripts only run the Linux tests and lint, nothing else", () => {
    expect(ciPlan(PR, ["docs/TDD.md", "README.md"])).toEqual(NONE);
    expect(ciPlan(PR, ["scripts/lib/slot.ts", "scripts/test/slot.test.ts"])).toEqual(NONE);
    expect(ciPlan(PR, [])).toEqual(NONE);
  });

  test("the daemon or a smoke adds Windows and the smokes", () => {
    const daemon = { ...NONE, windows: true, smokes: true };
    expect(ciPlan(PR, ["apps/daemon/src/main.ts"])).toEqual(daemon);
    expect(ciPlan(PR, ["scripts/smoke-limits.ts"])).toEqual(daemon);
  });

  test("the app, the protocol, the dependencies or the workflow run everything but cargo", () => {
    const all = { ...FULL, cargo: false };
    for (const path of [
      "apps/desktop/src/ui/App.tsx",
      "packages/protocol/src/index.ts",
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "tsconfig.base.json",
      ".github/workflows/ci.yml",
    ]) {
      expect(`${path}: ${JSON.stringify(ciPlan(PR, [path]))}`).toBe(
        `${path}: ${JSON.stringify(all)}`,
      );
    }
  });

  test("the Tauri shell runs everything and cargo", () => {
    expect(ciPlan(PR, ["apps/desktop/src-tauri/src/lib.rs"])).toEqual(FULL);
  });

  test("a push to main, a run by hand or a diff that cannot be read runs everything", () => {
    expect(ciPlan("push", ["docs/TDD.md"])).toEqual(FULL);
    expect(ciPlan("workflow_dispatch", [])).toEqual(FULL);
    expect(ciPlan(PR, null)).toEqual(FULL);
  });

  test("the plan becomes one GitHub output per job group", () => {
    expect(planOutputs({ ...NONE, windows: true })).toBe(
      "windows=true\nsmokes=false\nscreenshots=false\ncargo=false\n",
    );
  });
});

describe("ci-paths: the workflow", () => {
  test("a changes job computes the plan and every job group reads it", () => {
    expect(runs("changes")).toContain("bun run scripts/ci-paths.ts");
    expect(Object.keys(job("changes").outputs ?? {})).toEqual([
      "windows",
      "smokes",
      "screenshots",
      "cargo",
    ]);
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(job(key).needs).toContain("changes");
      expect(job(key).if ?? "").toContain(gate("windows"));
    }
    for (const key of ["screenshots-prints", "screenshots-e2e"]) {
      expect(job(key).needs).toContain("changes");
      expect(job(key).if ?? "").toContain(gate("screenshots"));
    }
    expect(step("test", "Smokes")?.if).toBe(gate("smokes"));
  });

  test("cargo runs only when the plan says so, after rust-cache", () => {
    for (const key of ["test", "checks-windows"]) {
      const steps = job(key).steps;
      const cache = steps.findIndex((s) => (s.uses ?? "").startsWith("Swatinem/rust-cache@"));
      const cargo = steps.findIndex((s) => (s.run ?? "").includes("cargo check"));
      expect(`${key}: ${cache >= 0 && cache < cargo}`).toBe(`${key}: true`);
      expect(steps[cache]?.uses).toMatch(/^Swatinem\/rust-cache@[0-9a-f]{40}$/);
      expect(steps[cache]?.if).toBe(gate("cargo"));
      expect(steps[cargo]?.if ?? "").toContain(gate("cargo"));
    }
  });

  test("the e2e journeys run in three Playwright shards, each with its own artifacts", () => {
    expect(job("screenshots-e2e").strategy?.matrix?.shard).toEqual([1, 2, 3]);
    expect(runs("screenshots-e2e")).toContain("bun run e2e -- --shard=${{ matrix.shard }}/3");
    const names = job("screenshots-e2e")
      .steps.map((s) => s.with?.name ?? "")
      .filter(Boolean);
    expect(names).toEqual([
      "relatorio-e2e-${{ matrix.shard }}",
      "e2e-failures-${{ matrix.shard }}",
    ]);
  });

  test("the required aggregates succeed when their jobs were skipped by path, and fail otherwise", () => {
    for (const [key, output] of [
      ["test-windows", "windows"],
      ["screenshots", "screenshots"],
    ] as const) {
      expect(job(key).needs?.[0]).toBe("changes");
      // A failed plan has no outputs: it must fail the check, never read as "skipped".
      const check = runs(key);
      const planned = check.indexOf('test "${{ needs.changes.result }}" = success');
      expect(planned >= 0 && planned < check.indexOf("skipped by path")).toBe(true);
      expect(runs(key)).toContain(`if [ "\${{ needs.changes.outputs.${output} }}" != true ]; then`);
      expect(runs(key)).toContain("skipped by path");
    }
  });

  test("lint:sonar on a PR is the per-rule ratchet only, so a red X means a rule went up", () => {
    expect(job("sonar-lint").name).toBe("lint:sonar (ratchet)");
    expect(runs("sonar-lint")).toContain("bun run lint:sonar -- --ratchet");
    expect(runs("sonar-lint")).not.toContain("--base");
  });
});
