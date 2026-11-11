#!/usr/bin/env bun
/**
 * `bun run typecheck`: one incremental tsc per project, two at a time when 8 GB are free and in
 * sequence otherwise (scripts/lib/typecheck.ts).
 * The package script runs it inside the light lane (scripts/lane.ts).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runAll, typecheckJobs, typecheckPlan } from "./lib/typecheck.ts";

const ROOT = resolve(import.meta.dir, "..");
/** The memory left now: /proc/meminfo on Linux, null elsewhere (one run at a time). */
function meminfo(): string | null {
  try {
    return readFileSync("/proc/meminfo", "utf8");
  } catch {
    return null;
  }
}

mkdirSync(join(ROOT, "node_modules/.cache/tsc"), { recursive: true });
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
