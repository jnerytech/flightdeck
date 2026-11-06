#!/usr/bin/env bun
/**
 * `bun run scripts/unstable-issues.ts` (#494, the CI's quick job): every unstable skip's issue must
 * still be open, so a skip comes out with the fix. Reads each issue's state with gh (the run's
 * token); exits 1 naming the closed ones, or the ones gh cannot read. The logic is in
 * lib/unstable-skip.ts.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { closedSkipIssues, unstableSkipIssues } from "./lib/unstable-skip.ts";

const ROOT = resolve(import.meta.dir, "..");
const issues = unstableSkipIssues(ROOT);
const { closed, unknown } = await closedSkipIssues(issues, async (issue) => {
  const args = ["api", `repos/{owner}/{repo}/issues/${issue}`, "--jq", ".state"];
  // One retry: a rate limit or a 5xx must not turn every PR red (#494 review).
  for (let attempt = 0; attempt < 2; attempt++) {
    const gh = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8" }); // NOSONAR: gh from the CI runner's PATH
    if (gh.status === 0) return gh.stdout.trim();
  }
  return null;
});
console.log(`unstable skips: ${issues.length} issue(s) noted`);
for (const issue of closed) {
  console.error(`#${issue} is closed: its fix is in, so take its unstable skip out`);
}
for (const issue of unknown) {
  console.error(
    `#${issue} cannot be read with gh (twice): a GitHub outage, or a number that is no issue`,
  );
}
process.exit(closed.length + unknown.length > 0 ? 1 : 0);
