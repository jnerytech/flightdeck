import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #3541: the release builds, signs and packs the daemons on Linux, once, and the Windows job
 * publishes what that job made. The tarball carries the signed bytes, and nothing goes to the npm registry.
 */
interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  needs?: string | string[];
  "runs-on"?: string;
  permissions?: Record<string, string>;
  steps: Step[];
}

const text = readFileSync(
  join(import.meta.dir, "..", "..", "..", ".github", "workflows", "release.yml"),
  "utf8",
);
const jobs = (Bun.YAML.parse(text) as { jobs: Record<string, Job> }).jobs;
const daemons = jobs.daemons;
const release = jobs.release;
const runs = (job?: Job) => (job?.steps ?? []).map((step) => step.run ?? "");
const first = (job: Job | undefined, command: string) =>
  runs(job).findIndex((run) => run.includes(command));

describe("release.yml: the daemons and the npm tarball are made on Linux (#3541)", () => {
  test("a job on ubuntu with read-only access builds, signs, packs and smokes the tarball, in that order", () => {
    expect([daemons?.["runs-on"], daemons?.permissions]).toEqual([
      "ubuntu-latest",
      { contents: "read" },
    ]);
    const order = ["release:version", "build:daemon", "release:sign", "release:npm", "install -g"];
    const at = order.map((command) => first(daemons, command));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("the smoke installs the tarball into a temporary prefix and runs both commands from it", () => {
    const smoke = runs(daemons).find((run) => run.includes("install -g")) ?? "";
    expect(smoke).toContain('--prefix "$RUNNER_TEMP/');
    expect(smoke).toContain('/bin/flightdeckd" --version');
    expect(smoke).toContain('/bin/fd" --version');
  });

  test("the smoke hands npm a path it reads as a file: a bare dist/x.tgz is a GitHub user/repo shorthand", () => {
    const smoke = runs(daemons).find((run) => run.includes("install -g")) ?? "";
    const assigned = /^\s*tarball="([^"]+)"/m.exec(smoke)?.[1] ?? "";
    expect(assigned).toMatch(/^(\.\/|\/|\$\{?GITHUB_WORKSPACE)/);
  });

  test("an install line in the docs names a URL or a path, never a bare file name", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    const pages = [
      "docs/manual/en/installation.md",
      "docs/manual/pt-BR/installation.md",
      "docs/decisions/2026-11-20-npm-tarball.md",
    ];
    const bare = pages.flatMap((page) =>
      [...readFileSync(join(root, page), "utf8").matchAll(/npm (?:i|install)\b[^\n`]*?(\S+\.tgz)/g)]
        .map((m) => m[1] ?? "")
        .filter((target) => !/^(https?:\/\/|\.{1,2}\/|\/)/.test(target)),
    );
    expect(bare).toEqual([]);
  });

  test("only the signing step holds the signing key", () => {
    const holders = (daemons?.steps ?? []).filter((step) =>
      Object.keys(step.env ?? {}).includes("TAURI_SIGNING_PRIVATE_KEY"),
    );
    expect(holders.map((step) => step.run)).toEqual(["bun run release:sign"]);
  });

  test("the Windows job waits for it, downloads what it made into dist/ and builds no daemon", () => {
    expect([release?.needs].flat()).toEqual(["daemons"]);
    const download = (release?.steps ?? []).findIndex((step) =>
      (step.uses ?? "").startsWith("actions/download-artifact@"),
    );
    expect(download).toBeGreaterThan(-1);
    expect(release?.steps[download]?.with?.path).toBe("dist");
    expect(first(release, "release:assets")).toBeGreaterThan(download);
    expect(first(release, "build:daemon")).toBe(-1);
    expect(first(release, "release:sign")).toBe(-1);
  });

  test("the artifacts of both jobs are pinned by commit, and nothing publishes to the npm registry", () => {
    const uses = [daemons, release].flatMap((job) =>
      (job?.steps ?? []).map((step) => step.uses ?? "").filter((u) => /artifact@/.test(u)),
    );
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(uses.every((u) => /@[0-9a-f]{40} # v\d+$/.test(u) || /@[0-9a-f]{40}$/.test(u))).toBe(
      true,
    );
    expect(/npm (publish|login|adduser)|NPM_TOKEN|registry\.npmjs/.test(text)).toBe(false);
  });
});
