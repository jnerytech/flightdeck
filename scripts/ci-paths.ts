#!/usr/bin/env bun
/**
 * `bun run scripts/ci-paths.ts` (the first step of the CI's quick job, #264, #444): which jobs this run needs,
 * written to $GITHUB_OUTPUT. On a pull request it diffs against the merge-base with the target
 * branch; anything else, or a diff it cannot read, runs everything. The rules are in lib/ci-paths.ts.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { ciPlan, planOutputs, selectionBase } from "./lib/ci-paths.ts";

const event = process.env.GITHUB_EVENT_NAME ?? "";
// The selection's base (#444): the PR's target, or the commit a push to main came after.
const base = selectionBase(event, process.env.GITHUB_BASE_REF ?? "", process.env.BEFORE ?? "");
let changed: string[] | null = null;
let removed: string[] = [];
const lines = (args: string[]): string[] | null => {
  const diff = spawnSync("git", args, { encoding: "utf8" }); // NOSONAR: git from the CI runner's PATH
  return diff.status === 0 ? diff.stdout.split("\n").filter(Boolean) : null;
};
if (base) {
  // A PR diffs against the merge-base with its target; a push against the commit before it.
  const range = event === "pull_request" ? `${base}...HEAD` : `${base}..HEAD`;
  changed = lines(["diff", "--name-only", range]);
  // A deleted test runs the whole suite (test:related --pr), so the Windows shards go to three.
  removed = lines(["diff", "--name-only", "--diff-filter=D", range]) ?? [];
}
const outputs = `${planOutputs(ciPlan(event, changed, removed))}base=${changed === null ? "" : base}\n`;
const scope = changed === null ? "everything" : `${changed.length} changed file(s)`;
console.log(`${event}: ${scope}`);
console.log(outputs.trim());
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
