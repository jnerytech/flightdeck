#!/usr/bin/env bun
/**
 * `bun run scripts/unstable-issues.ts` (#494, the CI's quick job): every unstable skip's issue must
 * still be open, so a skip comes out with the fix. Reads each issue's state with gh (the run's
 * token); exits 1 naming the closed ones, or the ones gh cannot read. On a pull request (#552) it
 * also fails when the PR closes an issue a skip is still noted under (a closing keyword in its body
 * or its commits' messages), naming the skip's file:line: merging it would close the issue and turn
 * every later PR red. The logic is in lib/unstable-skip.ts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  closedSkipIssues,
  closingIssues,
  notesClosedBy,
  pullRequestText,
  unstableNotes,
} from "./lib/unstable-skip.ts";

const ROOT = resolve(import.meta.dir, "..");
const notes = unstableNotes(ROOT);
const issues = [...new Set(notes.map((note) => note.issue))].sort((a, b) => a - b);
const { closed, unknown } = await closedSkipIssues(issues, async (issue) => {
  const args = ["api", `repos/{owner}/{repo}/issues/${issue}`, "--jq", ".state"];
  // One retry: a rate limit or a 5xx must not turn every PR red (#494 review).
  for (let attempt = 0; attempt < 2; attempt++) {
    const gh = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8" }); // NOSONAR: gh from the CI runner's PATH
    if (gh.status === 0) return gh.stdout.trim();
  }
  return null;
});
const text = pullRequestText({
  env: process.env,
  readFile: (path) => readFileSync(path, "utf8"),
  commitMessages: (base, head) => {
    const args = ["log", "--format=%B", `${base}..${head}`];
    const git = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }); // NOSONAR: git from the CI runner's PATH
    if (git.status !== 0) throw new Error(`git log ${base}..${head} failed: ${git.stderr.trim()}`);
    return git.stdout;
  },
});
const closedHere = text === null ? [] : notesClosedBy(notes, closingIssues(text));
console.log(`unstable skips: ${issues.length} issue(s) noted`);
for (const issue of closed) {
  console.error(`#${issue} is closed: its fix is in, so take its unstable skip out`);
}
for (const issue of unknown) {
  console.error(
    `#${issue} cannot be read with gh (twice): a GitHub outage, or a number that is no issue`,
  );
}
for (const note of closedHere) {
  console.error(
    `${note.file}:${note.line} still skips under #${note.issue}, which this PR closes: take the skip out in this PR`,
  );
}
process.exit(closed.length + unknown.length + closedHere.length > 0 ? 1 : 0);
