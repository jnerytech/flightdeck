# pr auto merges a PR that is already clean (issue #374)

- **Why.** GitHub refuses to turn auto-merge on for a PR that is already mergeable ("Pull request is
  in clean status"). `bun run pr -- auto` then told the session to wait for the coordinator, so a
  green PR waited for a person (#328 and #361 on 2026-11-06). Auto-merge would have merged it the
  moment it became clean.
- **What.** On that refusal only, `auto` merges the PR itself, with a merge commit, through the
  same checks as the coordinator's hand merge (`mergeChecked` in `scripts/lib/pr-flow.ts`):
  - it reads the main ruleset's required checks, and stops when they cannot be read;
  - the PR is not a draft and targets `main`;
  - every required check is green on the PR's head commit;
  - GitHub's `mergeable_state` is exactly `clean` (`unknown`, `behind`, `blocked`, `unstable` and
    `dirty` refuse: run `auto` again later);
  - the merge request is pinned to that head commit (`sha=`), so a push after the check merges
    nothing.

  Any other refusal from GitHub still fails. `bun run pr -- merge` stays the coordinator's.
- **What changes in the rules.** A session no longer hands a clean, green PR to the coordinator.
  The guard hook still refuses a session's `gh pr merge`, REST merge and `pr merge`. It does not
  see this merge, because the merge runs inside `bun run pr -- auto`. The gate is the script's own
  checks, which are at least as strict as GitHub's auto-merge.
- **Known limits** (security review, all low):
  - `auto` takes any PR number. Holding a PR by not turning auto-merge on no longer works once the
    PR is clean and green. Hold it as a draft instead.
  - A required check that flips in the few seconds between the check and the merge is caught by
    GitHub's ruleset, but not under a token that can bypass the ruleset.
  - Required checks are matched by name, as auto-merge does when the ruleset pins no app
    (`integration_id`).
