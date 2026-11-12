#!/usr/bin/env bun
/**
 * `bun run scripts/structure-guard.ts`: the structure-only PR guard (issue #1602). On a PR whose
 * commits are all `refactor(...)`, or that has the `structure` label (`PR_LABELS`, comma-separated,
 * set by CI), it fails when a test changed beyond its import paths, a test file was added or
 * deleted, or a dictionary text changed. The logic is scripts/lib/guards/structure-guard.ts.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runStructureGuard } from "./lib/guards/structure-guard.ts";

const ROOT = resolve(import.meta.dir, "..");
const result = runStructureGuard({
  labels: (process.env.PR_LABELS ?? "").split(",").map((label) => label.trim()),
  git: (args) => {
    // Unquoted paths, so a test with a non-ASCII name is read and compared (#1602 security review).
    const all = ["-c", "core.quotePath=false", ...args];
    const proc = spawnSync("git", all, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); // NOSONAR: git from the PATH of the developer or the CI runner
    return proc.status === 0 ? proc.stdout : null;
  },
});
(result.code === 0 ? console.log : console.error)(result.output);
process.exit(result.code);
