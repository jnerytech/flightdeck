#!/usr/bin/env bun
/**
 * `bun run scripts/ci-paths.ts` (the first step of the CI's quick job, #264, #444): which jobs this run needs,
 * written to $GITHUB_OUTPUT. On a pull request it diffs against the merge-base with the target
 * branch; anything else, or a diff it cannot read, runs everything. The rules are in lib/ci-paths.ts.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { ciPlan, planOutputs, selectionBase } from "./lib/ci-paths.ts";
import { planRelated } from "./lib/test-related.ts";
import { testTiers } from "./lib/test-tiers.ts";

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
// How many integration and e2e test files the selection holds (test:related --pr): many take three
// Windows shards. The fast tiers are always in it, and one shard runs them in minutes.
let selected = 0;
if (changed !== null) {
  const tracked = lines(["ls-files", "*.ts", "*.tsx"]) ?? [];
  const sources = new Map(tracked.map((path) => [path, readFileSync(path, "utf8")]));
  const tiers = testTiers(sources);
  const plan = planRelated({
    base,
    platform: process.platform,
    git: (args) => {
      const run = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 }); // NOSONAR: git from the CI runner's PATH
      return run.status === 0 ? run.stdout : null;
    },
    readFile: (path) => sources.get(path) ?? readFileSync(path, "utf8"),
    pyramid: true,
    slot: false,
    tierOf: (path) => tiers[path],
  });
  const slow = (path: string) => tiers[path] !== "unit" && tiers[path] !== "component";
  selected =
    plan.files === "all" ? Number.POSITIVE_INFINITY : (plan.files ?? []).filter(slow).length;
}
const outputs = `${planOutputs(ciPlan(event, changed, removed, selected))}base=${changed === null ? "" : base}\n`;
const scope = changed === null ? "everything" : `${changed.length} changed file(s)`;
console.log(`${event}: ${scope}, ${selected} selected integration or e2e test file(s)`);
console.log(outputs.trim());
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
