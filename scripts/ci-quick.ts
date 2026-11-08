#!/usr/bin/env bun
/**
 * `bun run scripts/ci-quick.ts` (the CI's quick job, issue #272): runs every ratchet test, the
 * protocol surface and md-links (#1068) in one call, with the area config (no coverage). The list
 * is lib/ci-quick.ts.
 */
import { spawnSync } from "node:child_process";
import { quickTests } from "./lib/ci-quick.ts";

const tracked = spawnSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], { encoding: "utf8" }); // NOSONAR: git from the PATH of the CI runner or the developer
const tests = quickTests(tracked.stdout.split("\n").filter(Boolean));
console.log(`ci-quick: ${tests.length} quick test file(s)`);
if (tracked.status !== 0 || tests.length === 0) process.exit(1);
// The bun running this script, not one looked up on the PATH.
const run = spawnSync(
  process.execPath,
  ["--config=bunfig.area.toml", "test", ...tests.map((path) => `./${path}`)],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
