#!/usr/bin/env bun
/**
 * `bun run scripts/ci-paths.ts` (the CI's `changes` job, issue #264): which jobs this run needs,
 * written to $GITHUB_OUTPUT. On a pull request it diffs against the merge-base with the target
 * branch; anything else, or a diff it cannot read, runs everything. The rules are in lib/ci-paths.ts.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { ciPlan, planOutputs } from "./lib/ci-paths.ts";

const event = process.env.GITHUB_EVENT_NAME ?? "";
const base = process.env.GITHUB_BASE_REF ?? "";
let changed: string[] | null = null;
if (event === "pull_request" && base) {
  const args = ["diff", "--name-only", `origin/${base}...HEAD`];
  const diff = spawnSync("git", args, { encoding: "utf8" }); // NOSONAR: git from the CI runner's PATH
  changed = diff.status === 0 ? diff.stdout.split("\n").filter(Boolean) : null;
}
const outputs = planOutputs(ciPlan(event, changed));
const scope = changed === null ? "everything" : `${changed.length} changed file(s)`;
console.log(`${event}: ${scope}`);
console.log(outputs.trim());
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
