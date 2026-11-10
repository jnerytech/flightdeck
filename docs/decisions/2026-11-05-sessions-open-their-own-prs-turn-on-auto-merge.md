# Sessions open their own PRs and turn on auto-merge (issue #271)

- **Why.** The owner decided (2026-11-05) that a session delivers its own work: it pushes its
  branch, opens the PR and turns on auto-merge, so a green PR no longer waits for the coordinator.
  The coordinator keeps main, hand merges, tags, releases and the repository settings.
- **`bun run pr -- auto <n>`** calls GraphQL's `enablePullRequestAutoMerge` with `MERGE` (REST has
  no auto-merge endpoint). The ruleset's required checks gate the merge, as for `pr merge`. It
  refuses a draft (GitHub would too). The main ruleset is strict
  (`strict_required_status_checks_policy`), so GitHub also waits until the PR is up to date, as
  `pr merge` checks; auto-merge never updates the branch itself (`pr update <n>` does). GitHub
  refuses auto-merge for a PR that can merge already ("clean status"); `auto` then says the
  coordinator merges it, since a session does not merge by hand.
- **Stacked PRs.** Auto-merge onto a branch with no ruleset would merge at once, into the parent.
  So `auto` refuses a PR onto a branch that `main` does not have yet. The repository does not
  delete a branch on merge, so GitHub never retargets the child by itself: once `main` has the
  parent (`compare` says `ahead_by` 0), `auto` moves the PR onto `main` and turns auto-merge on.
  A compare that fails refuses; it never counts as merged.
- **The guard** (`prMergeViolation`) blocks `bun run pr -- merge|tag`, `gh pr merge` and a REST
  `pulls/N/merge` in a session. It reads `FLIGHTDECK_COORDINATOR` from the hook's own environment,
  so setting it in the command does not pass. `pr merge` refuses without the variable too. Like the
  other command rules, it reads words outside quotes: a quoted `'…/pulls/12/merge'` path passes.
  The hook is a guard against slips, not a security boundary.
- **WIP limit.** At most 2 open branches per session, stated in CLAUDE.md and docs/TDD.md. It is
  not enforced in code.
