#!/usr/bin/env bun
/**
 * `bun run scripts/ci-quick.ts` (the CI's quick job, issue #272): runs every ratchet test and the
 * protocol surface in one call, with the area config (no coverage). The list is lib/ci-quick.ts.
 */
import { spawnSync } from "node:child_process";
import { quickTests } from "./lib/ci-quick.ts";

const tracked = spawnSync("git", ["ls-files", "*.test.ts", "*.test.tsx"], { encoding: "utf8" });
const tests = quickTests(tracked.stdout.split("\n").filter(Boolean));
console.log(`ci-quick: ${tests.length} ratchet test file(s)`);
if (tracked.status !== 0 || tests.length === 0) process.exit(1);
const run = spawnSync(
  "bun",
  ["--config=bunfig.area.toml", "test", ...tests.map((path) => `./${path}`)],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
