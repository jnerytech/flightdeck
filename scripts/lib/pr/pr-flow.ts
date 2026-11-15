import { autoPr, mergePr, nextPrs, updatePr } from "./pr-merge.ts";
import { openPr } from "./pr-open.ts";
import { type PrFlowDeps, usage } from "./pr-types.ts";
import { tagRelease } from "./release-tag.ts";

/**
 * `bun run pr -- <open|next|update|merge> …` (issue #260, GitHub Flow): one PR per branch to main,
 * each merged on its own when its required checks are green on its HEAD. All of it through REST
 * (`gh api`): `open` titles the PR after the branch's issue and closes it (`--refs <n>` only
 * references it, for a PR that is one slice of the issue, #839), `next` lists the open PRs
 * in the order to merge them (a stacked PR after its parent) with what each still needs, `update`
 * brings a PR up to date with its base, `auto` (any session, #271) turns on GitHub's auto-merge
 * (or, for a PR already clean and green, merges it as auto-merge would, #374), and `merge` (the
 * coordinator only) merges with a merge commit, never a squash.
 */

export type { CheckRun } from "./pr-checks.ts";
export { checksVerdict, headCi } from "./pr-checks.ts";
export { mergeOrder } from "./pr-merge.ts";
export { issueOf, issuesOf, sliceTitle } from "./pr-open.ts";
export type { Pr, PrFlowDeps } from "./pr-types.ts";
export { FULL_SUITE_JOB, VERSION_FILE } from "./release-tag.ts";

/** Runs one command; the exit code (2 for a usage error or a refusal). */
export async function prFlow(argv: string[], deps: PrFlowDeps): Promise<number> {
  const [command, ...args] = argv;
  const n = Number(args[0]);
  if (command === "open") return await openPr(args, deps);
  if (command === "next") return await nextPrs(deps);
  if (command === "update" && Number.isInteger(n) && n > 0) return await updatePr(n, deps);
  if (command === "merge" && Number.isInteger(n) && n > 0) return await mergePr(n, deps);
  if (command === "auto" && Number.isInteger(n) && n > 0) {
    // #1697: OpenCode was retired, so there is no review to wait for; a leftover --now means nothing.
    if (args.includes("--now")) {
      deps.log("--now is no longer needed: pr auto does not wait for a review (#1697)");
    }
    return await autoPr(n, deps);
  }
  if (command === "tag") return await tagRelease(args, deps);
  return usage(deps);
}
