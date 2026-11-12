import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

import { type CacheFiles, seedCache } from "../../lib/typecheck/tsc-cache.ts";
import { realTempDir } from "../temp-dir.ts";

/** An in-memory cache: path to its last change in ms. */
function memory(at: Record<string, number>) {
  const copies: [string, string][] = [];
  const files: CacheFiles = {
    exists: (path) => path in at,
    mtime: (path) => at[path] ?? 0,
    copy: (from, to) => {
      copies.push([from, to]);
    },
  };
  return { files, copies };
}

const C = "node_modules/.cache/tsc";

describe("seedCache", () => {
  test("a build info this checkout lacks comes from the sibling that changed it last", () => {
    const m = memory({
      [`/w/old/${C}/a.tsbuildinfo`]: 100,
      [`/w/new/${C}/a.tsbuildinfo`]: 300,
      [`/w/mid/${C}/a.tsbuildinfo`]: 200,
    });
    const seeded = seedCache({
      root: "/w/me",
      siblings: ["/w/old", "/w/new", "/w/mid"],
      names: ["a.tsbuildinfo"],
      files: m.files,
    });
    expect(seeded).toEqual(["a.tsbuildinfo"]);
    expect(m.copies).toEqual([[`/w/new/${C}/a.tsbuildinfo`, `/w/me/${C}/a.tsbuildinfo`]]);
  });

  test("a build info this checkout already has is never overwritten", () => {
    const m = memory({
      [`/w/me/${C}/a.tsbuildinfo`]: 50,
      [`/w/new/${C}/a.tsbuildinfo`]: 300,
    });
    expect(
      seedCache({ root: "/w/me", siblings: ["/w/new"], names: ["a.tsbuildinfo"], files: m.files }),
    ).toEqual([]);
    expect(m.copies).toEqual([]);
  });

  test("a name no sibling has is left for tsc to build", () => {
    const m = memory({ [`/w/new/${C}/a.tsbuildinfo`]: 300 });
    const seeded = seedCache({
      root: "/w/me",
      siblings: ["/w/new"],
      names: ["a.tsbuildinfo", "b.tsbuildinfo"],
      files: m.files,
    });
    expect(seeded).toEqual(["a.tsbuildinfo"]);
  });
});

describe("a seeded build info is safe", () => {
  test("tsc still reports a type error that the donor's sources did not have", () => {
    const base = realTempDir("tsc-seed-");
    const project = (dir: string, source: string) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/a.ts"), source);
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
      );
    };
    const tsc = (dir: string) =>
      spawnSync(
        process.execPath,
        [
          join(ROOT, "node_modules/typescript/bin/tsc"),
          "-p",
          "tsconfig.json",
          "--incremental",
          "--tsBuildInfoFile",
          "cache/p.tsbuildinfo",
        ],
        { cwd: dir, encoding: "utf8" },
      );
    try {
      const donor = join(base, "donor");
      const worktree = join(base, "worktree");
      project(donor, "export const a: number = 1;\n");
      expect(tsc(donor).status).toBe(0);
      project(worktree, 'export const a: number = "one";\n');
      mkdirSync(join(worktree, "cache"), { recursive: true });
      copyFileSync(join(donor, "cache/p.tsbuildinfo"), join(worktree, "cache/p.tsbuildinfo"));
      const run = tsc(worktree);
      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain("src/a.ts");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
