#!/usr/bin/env bun
/**
 * The `baseline-json` git merge driver (#2270): `bun scripts/merge-baseline.ts %O %A %B`. Writes
 * the key-by-key merge into the current version (%A) and exits 0, or leaves %A alone and exits 1
 * so the driver's command falls back to git's line merge and its conflict markers.
 * The logic is in `scripts/lib/baseline-merge.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { mergeBaselines } from "./lib/baseline-merge.ts";

const [base, ours, theirs] = process.argv.slice(2);
if (!base || !ours || !theirs) {
  console.error("usage: bun scripts/merge-baseline.ts <base> <ours> <theirs>");
  process.exit(1);
}
const merged = mergeBaselines(
  readFileSync(base, "utf8"),
  readFileSync(ours, "utf8"),
  readFileSync(theirs, "utf8"),
);
if (!merged.ok) {
  console.error(`baseline-json: ${merged.reason}; left to git's line merge`);
  process.exit(1);
}
writeFileSync(ours, merged.text);
