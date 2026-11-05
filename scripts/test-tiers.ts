#!/usr/bin/env bun
/**
 * `bun run test:tiers` (issue #261): how many test files each tier holds, computed from the code
 * (lib/test-tiers.ts) on every call. No manifest is committed, so no PR has one to update.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TIERS, testTiers, tierCounts } from "./lib/test-tiers.ts";

const ROOT = resolve(import.meta.dir, "..");
const tracked = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
  .stdout.split("\n")
  .filter(Boolean);
const tiers = testTiers(new Map(tracked.map((p) => [p, readFileSync(join(ROOT, p), "utf8")])));
const counts = tierCounts(tiers);
console.log(TIERS.map((tier) => `${tier} ${counts[tier]}`).join(" · "));
