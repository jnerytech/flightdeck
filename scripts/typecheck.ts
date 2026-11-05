#!/usr/bin/env bun
/**
 * `bun run typecheck`: one incremental tsc per project, in sequence (scripts/lib/typecheck.ts).
 * The package script runs it inside the light lane (scripts/lane.ts).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runAll, typecheckPlan } from "./lib/typecheck.ts";

const ROOT = resolve(import.meta.dir, "..");
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
  ),
);
