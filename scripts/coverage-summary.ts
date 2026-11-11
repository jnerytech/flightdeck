#!/usr/bin/env bun
/**
 * `bun run scripts/coverage-summary.ts <lcov> <out>` (issue #1949): writes the line and function
 * totals of a merged lcov as JSON. CI keeps the file for 90 days for the release metrics snapshot;
 * a missing lcov writes nothing and exits 0, as a failed merge already failed its own step.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coverageSummary } from "./lib/metrics/coverage.ts";

const [lcov, out] = process.argv.slice(2).filter((arg) => arg !== "--");
if (!lcov || !out) {
  console.error("usage: bun run scripts/coverage-summary.ts <lcov> <out>");
  process.exit(2);
}
if (!existsSync(resolve(lcov))) {
  console.log(`coverage-summary: no ${lcov}, nothing written`);
  process.exit(0);
}
const summary = coverageSummary(readFileSync(resolve(lcov), "utf8"));
writeFileSync(resolve(out), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `coverage-summary: lines ${summary.linesPercent?.toFixed(1) ?? "n/a"}%, functions ${summary.functionsPercent?.toFixed(1) ?? "n/a"}%`,
);
