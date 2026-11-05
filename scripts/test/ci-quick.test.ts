import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { quickTests } from "../lib/ci-quick.ts";

const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  name?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string[];
  "runs-on"?: string;
  "timeout-minutes"?: number;
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
const QUICK_PASSED = 'test "${{ needs.quick.result }}" = success';

describe("ci-quick", () => {
  test("the quick tests are every ratchet and the protocol surface, in order (#272)", () => {
    expect(
      quickTests([
        "scripts/test/wait-ratchet.test.ts",
        "apps/desktop/test/layout-ratchet.test.ts",
        "scripts/test/protocol-surface.test.ts",
        "scripts/test/ci-quick.test.ts",
        "scripts/lib/wait-ratchet.ts",
        "scripts/test/perf-baseline.test.ts",
        "apps/desktop/test/x-ratchet.test.tsx",
      ]),
    ).toEqual([
      "apps/desktop/test/layout-ratchet.test.ts",
      "apps/desktop/test/x-ratchet.test.tsx",
      "scripts/test/protocol-surface.test.ts",
      "scripts/test/wait-ratchet.test.ts",
    ]);
  });

  test("a quick job runs typecheck, lint, the TDD audit and the ratchet tests (#272), no local Sonar (#283)", () => {
    const quick = job("quick");
    expect(quick.name).toBe("quick checks");
    expect(quick["runs-on"]).toBe("ubuntu-latest");
    expect(quick["timeout-minutes"]).toBeLessThanOrEqual(10);
    expect(quick.needs).toBeUndefined();
    const commands = runs("quick");
    for (const command of [
      "bun run typecheck",
      "bun run lint",
      "bun run tdd:audit -- --since auto",
      "bun run scripts/ci-quick.ts",
    ]) {
      expect(commands).toContain(command);
    }
    // The TDD audit counts from the merge-base: it needs the whole history.
    expect(quick.steps[0]?.with?.["fetch-depth"]).toBe(0);
    expect(ci.jobs["sonar-lint"]).toBeUndefined();
    expect(commands).not.toContain("lint:sonar");
  });

  test("the heavy jobs wait for the quick one, and the Linux suite no longer repeats its checks (#272)", () => {
    for (const key of [
      "test",
      "test-suite",
      "checks-linux",
      "test-windows-shard",
      "checks-windows",
      "screenshots-prints",
      "screenshots-e2e",
    ]) {
      expect(`${key}: ${job(key).needs?.includes("quick")}`).toBe(`${key}: true`);
    }
    expect(runs("test")).not.toContain("bun run typecheck");
    expect(runs("test")).not.toContain("bun run lint");
    expect(runs("test")).not.toContain("tdd:audit");
  });

  test("a failed quick job fails every required check instead of skipping it (#272)", () => {
    // GitHub counts a skipped required check as passed: `test (ubuntu-latest)` runs anyway and
    // fails at once, and each aggregate checks the quick result before the skip by path.
    expect(job("test").if ?? "").toStartWith("!cancelled() && ");
    expect(job("test").steps[0]?.run ?? "").toContain(QUICK_PASSED);
    for (const key of ["test-windows", "screenshots"]) {
      expect(job(key).needs).toContain("quick");
      const check = runs(key);
      const passed = check.indexOf(QUICK_PASSED);
      expect(`${key}: ${passed >= 0 && passed < check.indexOf("skipped by path")}`).toBe(
        `${key}: true`,
      );
    }
  });
});
