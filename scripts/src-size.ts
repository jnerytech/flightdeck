#!/usr/bin/env bun
/**
 * `bun run scripts/src-size.ts [--baseline]`: the source files over 800 lines and the shallow
 * modules (issue #1592). Prints the report for a move's PR summary; `--baseline` rewrites
 * src-size-baseline.json, which only goes down (the src-size test fails on a file that grew or a
 * new one over the limit). The logic is scripts/lib/guards/src-size.ts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  crowdedDomains,
  isMeasured,
  oversizedSources,
  shallowModules,
} from "./lib/guards/src-size.ts";
import { tightened } from "./lib/ratchets/layout.ts";

const ROOT = resolve(import.meta.dir, "..");
const LIST = ["ls-files", "apps/*/src/**", "packages/*/src/**"];
const listed = spawnSync("git", LIST, { cwd: ROOT, encoding: "utf8" }); // NOSONAR: git from the PATH of the developer running the script
const files = listed.stdout
  .split("\n")
  .filter(isMeasured)
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
const counts = oversizedSources(files);
const file = join(ROOT, "src-size-baseline.json");
if (process.argv.includes("--baseline")) {
  let baseline: Record<string, number> = {};
  try {
    baseline = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // No baseline yet: the first one is today's sizes.
    baseline = counts;
  }
  const next = tightened(counts, baseline);
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}
const shallow = shallowModules(files);
console.log(`Source files over 800 lines: ${Object.keys(counts).length}`);
for (const [path, n] of Object.entries(counts).sort(([, a], [, b]) => b - a))
  console.log(`  ${n}  ${path}`);
console.log(`Shallow modules (under 50 lines, forwarding one module): ${shallow.length}`);
for (const path of shallow) console.log(`  ${path}`);
for (const domain of crowdedDomains(shallow))
  console.log(`More than five shallow modules: ${domain}`);
