import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** #309: a PR runs the cheap base of the test pyramid; the full suite runs on main and every night. */
const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  name?: string;
  run?: string;
  if?: string;
}
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  on: { schedule?: { cron: string }[] };
  jobs: Record<string, { steps: Step[] }>;
};
const steps = ci.jobs["test-suite"]?.steps ?? [];
const step = (name: string) => steps.find((s) => s.name === name);

describe("ci-pyramid (#309)", () => {
  test("the full suite also runs every night, on a schedule", () => {
    const cron = ci.on.schedule?.[0]?.cron ?? "";
    expect(cron.split(" ")).toHaveLength(5);
  });

  test("on a PR the suite job runs the fast tiers plus the related tests, gated per changed file, and keeps the lcov for SonarCloud", () => {
    const pr = step("Testes do PR (pirâmide)");
    expect(pr?.if).toBe("github.event_name == 'pull_request'");
    expect(pr?.run).toBe(
      "bun run test:related -- --pr --base origin/${{ github.base_ref }} --keep-coverage coverage",
    );
  });

  test("on main, at night and by hand the suite job runs the whole suite with the 100% gate", () => {
    const full = step("Testes (cobertura 100%)");
    expect(full?.if).toBe("github.event_name != 'pull_request'");
    expect(full?.run).toBe("bun run test");
  });
});
