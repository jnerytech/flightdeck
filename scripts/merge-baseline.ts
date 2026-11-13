#!/usr/bin/env bun
/**
 * The `baseline-json` git merge driver (#2270): `bun scripts/merge-baseline.ts %O %A %B`. Writes
 * the key-by-key merge into the current version (%A) and exits 0, or writes both versions between
 * conflict markers into %A and exits 2, which the driver's command reports to git as a conflict.
 * Any other status (3 here, 1 for a crash) makes the command run git's line merge and report a
 * conflict. %A is replaced whole (a temporary file, then a rename), so a failed write leaves it as
 * it was for that line merge.
 * The logic is in `scripts/lib/ci/baseline-merge.ts`.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { conflictText, mergeBaselines } from "./lib/ci/baseline-merge.ts";

const [base, ours, theirs] = process.argv.slice(2);
if (!base || !ours || !theirs) {
  console.error("usage: bun scripts/merge-baseline.ts <base> <ours> <theirs>");
  process.exit(3);
}
/** Replaces %A whole: a write that fails halfway never leaves it truncated. */
const replaceOurs = (text: string) => {
  writeFileSync(`${ours}.baseline-json.tmp`, text);
  renameSync(`${ours}.baseline-json.tmp`, ours);
};
try {
  const oursText = readFileSync(ours, "utf8");
  const theirsText = readFileSync(theirs, "utf8");
  const merged = mergeBaselines(readFileSync(base, "utf8"), oursText, theirsText);
  if (!merged.ok) {
    replaceOurs(conflictText(oursText, theirsText));
    console.error(`baseline-json: ${merged.reason}; both versions left between conflict markers`);
    process.exit(2);
  }
  replaceOurs(merged.text);
} catch (error) {
  console.error(
    `baseline-json: ${(error as Error).message}; left to git's line merge, as a conflict`,
  );
  process.exit(3);
}
