import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #1949 (task 3): a tag that publishes a release also attaches its engineering metrics
 * snapshot, from a second job that never blocks the release.
 */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  "runs-on"?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}

const text = readFileSync(
  join(import.meta.dir, "..", "..", "..", ".github", "workflows", "release.yml"),
  "utf8",
);
const jobs = (Bun.YAML.parse(text) as { jobs: Record<string, Job> }).jobs;
const metrics = jobs.metrics;
const runs = (metrics?.steps ?? []).map((step) => step.run ?? "");

describe("release.yml: the metrics job (#1949)", () => {
  test("it is a second job on ubuntu that waits for the release job and may write to the release", () => {
    expect(metrics?.["runs-on"]).toBe("ubuntu-latest");
    expect([metrics?.needs].flat()).toEqual(["release"]);
    expect(metrics?.permissions).toEqual({ contents: "write" });
  });

  test("it checks the tag out with the whole history, which hotspots and coupling read", () => {
    const checkout = metrics?.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({ "fetch-depth": 0, ref: "${{ env.TAG }}" });
  });

  test("it writes metrics-<version>.json and attaches it to the release after the installers", () => {
    const write = runs.findIndex((run) => run.includes("bun run metrics"));
    const attach = runs.findIndex((run) => run.includes("gh release upload"));
    expect(write).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(write);
    expect(runs[write]).toContain('--tag "$TAG"');
    expect(runs[write]).toMatch(/--out "?metrics-.*\.json/);
    expect(runs[attach]).toContain('gh release upload "$TAG"');
    expect(runs[attach]).toContain("metrics-");
  });

  test("the tag reaches every script through the environment, never inside a script", () => {
    expect(metrics?.env?.TAG).toBeDefined();
    expect(metrics?.env?.GH_TOKEN).toBe("${{ github.token }}");
    for (const run of runs) expect(run).not.toContain("${{");
  });

  test("the release job still ends in the release it publishes, and holds no metrics step", () => {
    const release = jobs.release;
    expect(release?.steps.at(-1)?.run).toContain("gh release create");
    expect(
      (release?.steps ?? []).some((step) => (step.run ?? "").includes("bun run metrics")),
    ).toBe(false);
  });
});
