import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { overBaseline } from "../../lib/ratchets/layout.ts";
import { isScanned, spawnCounts } from "../../lib/ratchets/spawn-count.ts";

// repo-wide (#1108): reads every tracked source file, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../../..");

describe("spawn-count (#1612)", () => {
  test("source under a package's src is scanned; tests, declarations, adapters and the kernel exec helper are not", () => {
    expect(isScanned("apps/daemon/src/board/command.ts")).toBe(true);
    expect(isScanned("packages/protocol/src/index.ts")).toBe(true);
    expect(isScanned("apps/daemon/test/board/command.test.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/text-modules.d.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/kernel/exec.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/git/adapters/run.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/github/adapters/gh/run.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/adapters-notes/x.ts")).toBe(true);
    expect(isScanned("scripts/lib/slot/index.ts")).toBe(false);
  });

  test("each Bun.spawn and Bun.spawnSync call outside a comment counts, per file; files with none are left out", () => {
    expect(
      spawnCounts([
        {
          path: "apps/daemon/src/a.ts",
          text: "const p = Bun.spawn(cmd, {});\nconst q = Bun.spawnSync(cmd);\nawait Bun.spawn(x).exited;\n",
        },
        {
          path: "apps/daemon/src/b.ts",
          text: "// Bun.spawn(a) is avoided here\n * Bun.spawn(c)\n",
        },
        { path: "apps/daemon/src/c.ts", text: "const ok = runGit(args);\nthis.spawn(slot);\n" },
        { path: "apps/daemon/src/git/adapters/d.ts", text: "Bun.spawn(x);\n" },
        { path: "apps/daemon/src/kernel/exec.ts", text: "Bun.spawn(x);\n" },
        { path: "apps/daemon/test/e.test.ts", text: "Bun.spawn(x);\n" },
      ]),
    ).toEqual({ "apps/daemon/src/a.ts": 3 });
  });

  test("a new file with a launch, or a baseline file with more, fails the ratchet", () => {
    const counts = spawnCounts([
      { path: "apps/daemon/src/a.ts", text: "Bun.spawn(a);\nBun.spawn(b);\n" },
      { path: "apps/daemon/src/new.ts", text: "Bun.spawnSync(c);\n" },
    ]);
    expect(overBaseline(counts, { "apps/daemon/src/a.ts": 1 })).toEqual([
      "apps/daemon/src/a.ts: 2 > 1",
      "apps/daemon/src/new.ts: 1 > 0",
    ]);
  });

  test("no tracked source file launches more processes than spawn-count-baseline.json allows", () => {
    const paths = spawnSync("git", ["ls-files", "apps", "packages"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter(isScanned);
    expect(paths.length).toBeGreaterThan(500);
    const counts = spawnCounts(
      paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") })),
    );
    const baseline = JSON.parse(readFileSync(join(ROOT, "spawn-count-baseline.json"), "utf8"));
    expect(overBaseline(counts, baseline)).toEqual([]);
    expect(Object.keys(baseline).length).toBeGreaterThan(10);
  });
});
