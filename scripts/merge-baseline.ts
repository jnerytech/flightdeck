#!/usr/bin/env bun
/**
 * The `baseline-json` git merge driver (#2270): `bun scripts/merge-baseline.ts %O %A %B`. Writes
 * the key-by-key merge into the current version (%A) and exits 0, or writes both versions between
 * conflict markers into %A and exits 1, which git reports as a conflict.
 * The logic is in `scripts/lib/baseline-merge.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { conflictText, mergeBaselines } from "./lib/baseline-merge.ts";

const [base, ours, theirs] = process.argv.slice(2);
if (!base || !ours || !theirs) {
  console.error("usage: bun scripts/merge-baseline.ts <base> <ours> <theirs>");
  process.exit(1);
}
const oursText = readFileSync(ours, "utf8");
const theirsText = readFileSync(theirs, "utf8");
const merged = mergeBaselines(readFileSync(base, "utf8"), oursText, theirsText);
if (!merged.ok) {
  writeFileSync(ours, conflictText(oursText, theirsText));
  console.error(`baseline-json: ${merged.reason}; both versions left between conflict markers`);
  process.exit(1);
}
writeFileSync(ours, merged.text);
