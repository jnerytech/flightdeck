#!/usr/bin/env bun
/**
 * `bun run typecheck`: one incremental tsc per project, two at a time when 8 GB are free and in
 * sequence otherwise (scripts/lib/typecheck.ts).
 * The package script runs it inside the light lane (scripts/lane.ts).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
} from "node:fs";
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

/** A regular file only, never a link a sibling planted; any failure means "not there". */
const regular = (path: string) => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

/** Seeds the missing build info from the other worktrees; an optimisation, so it never stops the run. */
function seed(): void {
  try {
    const args = ["worktree", "list", "--porcelain"];
    const listed = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }); // NOSONAR: git from the PATH of the developer
    if (listed.status !== 0) return;
    const own = realpathSync(ROOT);
    const siblings = listed.stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter(
        (dir) =>
          regular(join(dir, TSC_CACHE, "scripts.tsbuildinfo")) ||
          regular(join(dir, TSC_CACHE, "apps-desktop.tsbuildinfo")),
      )
      .filter((dir) => realpathSync(dir) !== own);
    const seeded = seedCache({
      root: ROOT,
      siblings,
      names: PROJECTS.map((dir) => `${dir.replaceAll("/", "-")}.tsbuildinfo`),
      files: {
        exists: regular,
        mtime: (path) => lstatSync(path).mtimeMs,
        // Whole or not at all: a half copy would stop the next run from seeding.
        copy: (from, to) => {
          const staging = `${to}.${process.pid}`;
          copyFileSync(from, staging);
          renameSync(staging, to);
        },
      },
    });
    if (seeded.length > 0)
      console.error(`typecheck: ${seeded.length} build info(s) seeded from a sibling worktree`);
  } catch (error) {
    console.error(`typecheck: no seed (${(error as Error).message})`);
  }
}
seed();

const jobs = typecheckJobs(meminfo(), process.env.FLIGHTDECK_TYPECHECK_JOBS);
/** One tsc run. Side by side, each project's output is kept and printed whole when it ends. */
async function tsc(command: string[]): Promise<number> {
  if (jobs === 1)
    return await Bun.spawn([process.execPath, "x", ...command], {
      cwd: ROOT,
      stdio: ["inherit", "inherit", "inherit"],
    }).exited;
  const child = Bun.spawn([process.execPath, "x", ...command], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  process.stdout.write(out);
  process.stderr.write(err);
  return code;
}
process.exit(await runAll(typecheckPlan(), tsc, (line) => console.error(line), { limit: jobs }));
