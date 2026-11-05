#!/usr/bin/env bun
/**
 * `bun run test:tiers [-- --write]` (issue #261): prints how many test files each tier holds and
 * whether test-tiers.json is current; `--write` regenerates it. The logic is in lib/test-tiers.ts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TIERS, testTiers, tierCounts } from "./lib/test-tiers.ts";

const ROOT = resolve(import.meta.dir, "..");
const MANIFEST = join(ROOT, "test-tiers.json");
const tracked = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
  .stdout.split("\n")
  .filter(Boolean);
const tiers = testTiers(new Map(tracked.map((p) => [p, readFileSync(join(ROOT, p), "utf8")])));
const text = `${JSON.stringify(tiers, null, 2)}\n`;
const counts = tierCounts(tiers);
console.log(TIERS.map((tier) => `${tier} ${counts[tier]}`).join(" · "));
if (process.argv.includes("--write")) {
  writeFileSync(MANIFEST, text);
  console.log(`test:tiers: ${Object.keys(tiers).length} file(s) written to test-tiers.json`);
} else {
  let current = "";
  try {
    current = readFileSync(MANIFEST, "utf8");
  } catch {
    // No manifest yet.
  }
  if (current !== text) {
    console.error("test:tiers: test-tiers.json is stale: run bun run test:tiers -- --write");
    process.exit(1);
  }
}
