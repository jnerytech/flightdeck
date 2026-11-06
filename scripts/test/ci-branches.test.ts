import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * #260 (GitHub Flow): one trigger per kind of branch. A branch with an open PR runs on
 * `pull_request`, main on `push`, and a branch with no PR yet by hand (`workflow_dispatch`, which
 * ci:branch sends), so no branch pays for two runs of the same commit. A push to main that changes
 * only files no test reads starts no run.
 */
const ROOT = resolve(import.meta.dir, "../..");
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  on: Record<string, { branches?: string[]; "paths-ignore"?: string[]; paths?: string[] } | null>;
  concurrency: { group: string; "cancel-in-progress": boolean };
};

describe("ci-branches", () => {
  test("one trigger per kind of branch: main on push, a PR on pull_request, a branch with no PR by hand (#260)", () => {
    expect(ci.on.push?.branches).toEqual(["main"]);
    expect(ci.on.push && "tags" in ci.on.push).toBe(false);
    expect("pull_request" in ci.on).toBe(true);
    expect(ci.on.pull_request?.branches).toBeUndefined();
    expect("workflow_dispatch" in ci.on).toBe(true);
  });

  test("pull requests are never filtered by path, so required checks always report", () => {
    expect(ci.on.pull_request?.["paths-ignore"]).toBeUndefined();
    expect(ci.on.pull_request?.paths).toBeUndefined();
  });

  test("a push to main that only changes the images starts no run; the manuals run the docs checks (#235)", () => {
    expect(ci.on.push?.["paths-ignore"]).toEqual(["docs/images/**"]);
  });

  test("no test reads a file the push filter skips", () => {
    const tests = spawnSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter(Boolean);
    const globs = (ci.on.push?.["paths-ignore"] ?? []).map((p) => new Bun.Glob(p));
    const read = tests.flatMap((file) =>
      [...readFileSync(join(ROOT, file), "utf8").matchAll(/["'`]([\w./-]+)["'`]/g)]
        .map((m) => m[1] ?? "")
        .filter((literal) => globs.some((g) => g.match(literal)))
        .map((literal) => `${file}: ${literal}`),
    );
    expect(read).toEqual([]);
  });

  test("a new push to a branch cancels the run of its previous push", () => {
    expect(ci.concurrency.group).toMatch(/\$\{\{ github\.ref \}\}/);
    expect(ci.concurrency["cancel-in-progress"]).toBe(true);
  });
});
