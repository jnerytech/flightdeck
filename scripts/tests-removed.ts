#!/usr/bin/env bun
/**
 * `bun run scripts/tests-removed.ts`: the removed-tests guard (issue #2176). On the PR's net diff
 * from the merge-base with main, it fails when a test file has fewer tests or `expect(` calls than
 * at the base, or was deleted, unless a commit's `Tests-Removed: <path> — <why>` trailer names it.
 * The logic is scripts/lib/guards/tests-removed.ts.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runTestsRemoved } from "./lib/guards/tests-removed.ts";

const ROOT = resolve(import.meta.dir, "..");
const result = runTestsRemoved({
  git: (args) => {
    // Unquoted paths, so a test with a non-ASCII name is read and compared (as structure-guard.ts).
    const all = ["-c", "core.quotePath=false", ...args];
    const proc = spawnSync("git", all, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); // NOSONAR: git from the PATH of the developer or the CI runner
    return proc.status === 0 ? proc.stdout : null;
  },
});
(result.code === 0 ? console.log : console.error)(result.output);
process.exit(result.code);
