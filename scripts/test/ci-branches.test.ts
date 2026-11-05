import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * #216/#217: every pushed work branch runs the whole CI, so the heavy checks leave the Pi. A push
 * that changes only files no test reads starts no run.
 */
const ROOT = resolve(import.meta.dir, "../..");
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  on: Record<string, { branches?: string[]; "paths-ignore"?: string[]; paths?: string[] } | null>;
  concurrency: { group: string; "cancel-in-progress": boolean };
};

describe("ci-branches", () => {
  test("a push to any branch runs the CI, and a push of tags alone does not", () => {
    expect(ci.on.push?.branches).toEqual(["**"]);
    expect(ci.on.push && "tags" in ci.on.push).toBe(false);
  });

  test("pull requests are never filtered by path, so required checks always report", () => {
    expect(ci.on.pull_request?.["paths-ignore"]).toBeUndefined();
    expect(ci.on.pull_request?.paths).toBeUndefined();
  });

  test("a push that only changes the doc images starts no run; the manuals, which tests read, still run it", () => {
    // Not the manuals: the docs tests (md-links, md-size, the split) read them (#235).
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
