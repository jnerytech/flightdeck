#!/usr/bin/env bun
/**
 * `bun run fast-coverage [--write]` (#309): runs only the unit and component tiers with coverage
 * and checks that every source in fast-coverage-baseline.json is still at the coverage gate (80%) from them alone.
 * `--write` adds the newly covered sources, and refuses while a listed one dropped (the list only
 * grows). The logic is in lib/fast-coverage.ts; the tiers come from lib/test-tiers.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { byCodeUnit } from "@flightdeck/protocol";
import { hasRuntimeCode, isCoverageSource } from "./lib/coverage-check.ts";
import { fastCoverageVerdict, fullyCovered } from "./lib/fast-coverage.ts";
import { testTiers } from "./lib/test-tiers.ts";
import { testArgs } from "./test/timeout.ts";

const ROOT = resolve(import.meta.dir, "..");
const BASELINE = join(ROOT, "fast-coverage-baseline.json");
const write = process.argv.includes("--write");

const listed = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" }); // NOSONAR: git from the PATH of the developer or the CI runner
const tracked = listed.stdout.split("\n").filter(Boolean);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const tiers = testTiers(new Map(tracked.map((path) => [path, read(path)])));
const fast = Object.entries(tiers)
  .filter(([, tier]) => tier === "unit" || tier === "component")
  .map(([path]) => `./${path}`)
  .sort(byCodeUnit);
const sources = tracked
  .filter(isCoverageSource)
  .filter((path) => hasRuntimeCode(read(path), path.endsWith(".tsx") ? "tsx" : "ts"));

const dir = mkdtempSync(join(tmpdir(), "fast-coverage-"));
console.log(`fast-coverage: ${fast.length} unit and component test file(s)`);
const run = Bun.spawnSync(
  [
    process.execPath,
    "--config=bunfig.related.toml",
    ...testArgs(process.platform, [`--coverage-dir=${dir}`, ...fast]),
  ],
  { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
);
const lcov = existsSync(join(dir, "lcov.info")) ? readFileSync(join(dir, "lcov.info"), "utf8") : "";
rmSync(dir, { recursive: true, force: true });
if (run.exitCode !== 0 || !lcov) {
  console.error("fast-coverage: the fast tiers failed or left no coverage report");
  process.exit(1);
}

const covered = fullyCovered(lcov, sources);
// A missing baseline never passes as an empty one: only --write may create it.
if (!existsSync(BASELINE) && !write) {
  console.error("fast-coverage: fast-coverage-baseline.json is missing; create it with --write");
  process.exit(1);
}
const baseline: string[] = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const { dropped, gained, gone } = fastCoverageVerdict(covered, baseline, sources);
if (dropped.length > 0) {
  console.error(
    `fast-coverage: ${dropped.length} source(s) the fast tiers covered at the gate no longer are:`,
  );
  for (const path of dropped) console.error(`  - ${path}`);
  console.error(
    "Cover them again with unit or component tests (the base of the pyramid only grows).",
  );
  process.exit(1);
}
if (write) {
  writeFileSync(BASELINE, `${JSON.stringify(covered, null, 2)}\n`);
  console.log(
    `fast-coverage: ${covered.length} source(s) listed (+${gained.length}, -${gone.length} gone)`,
  );
} else {
  console.log(
    `fast-coverage: ${covered.length} of ${sources.length} source(s) at the gate from the fast tiers; the ${baseline.length} listed hold`,
  );
  if (gained.length > 0)
    console.log(
      `  ${gained.length} more could be listed: bun run slot -- bun run fast-coverage -- --write`,
    );
}
