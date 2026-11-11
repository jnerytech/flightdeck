#!/usr/bin/env bun
/**
 * `bun run typecheck`: one incremental tsc per project, two at a time when 8 GB are free and in
 * sequence otherwise (scripts/lib/typecheck.ts).
 * The package script runs it inside the light lane (scripts/lane.ts).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { seedCache, TSC_CACHE } from "./lib/tsc-cache.ts";
import { PROJECTS, runAll, typecheckJobs, typecheckPlan } from "./lib/typecheck.ts";

const ROOT = resolve(import.meta.dir, "..");
/** The memory left now: /proc/meminfo on Linux, null elsewhere (one run at a time). */
function meminfo(): string | null {
  try {
    return readFileSync("/proc/meminfo", "utf8");
  } catch {
    return null;
  }
}

mkdirSync(join(ROOT, TSC_CACHE), { recursive: true });
/** The other worktrees of this repository: `git worktree list`, this one left out. */
const siblings = spawnSync("git", ["worktree", "list", "--porcelain"], {
  cwd: ROOT,
  encoding: "utf8",
}) // NOSONAR: git from the PATH of the developer
  .stdout.split("\n")
  .filter((line) => line.startsWith("worktree "))
  .map((line) => resolve(line.slice("worktree ".length)))
  .filter((dir) => dir !== ROOT);
const seeded = seedCache({
  root: ROOT,
  siblings,
  names: PROJECTS.map((dir) => `${dir.replaceAll("/", "-")}.tsbuildinfo`),
  files: {
    exists: existsSync,
    mtime: (path) => statSync(path).mtimeMs,
    copy: copyFileSync,
  },
});
if (seeded.length > 0)
  console.error(`typecheck: ${seeded.length} build info(s) seeded from a sibling worktree`);
process.exit(
  await runAll(
    typecheckPlan(),
    async (command) =>
      await Bun.spawn([process.execPath, "x", ...command], {
        cwd: ROOT,
        stdio: ["inherit", "inherit", "inherit"],
      }).exited,
    (line) => console.error(line),
    { limit: typecheckJobs(meminfo(), process.env.FLIGHTDECK_TYPECHECK_JOBS) },
  ),
);
