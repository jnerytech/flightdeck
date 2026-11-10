# GitHub Flow: one PR per branch, a release is a tag on a green main (issue #260)

- **Why.** The owner wants small releases: a batch of 30 branches assembled into an rc conflicted
  in a dozen places and gated everything on the slowest branch. Each branch now reaches main
  through its own PR and merges alone when it is green.
- **One CI trigger per kind of branch.** `push` only on main (what a release tags), `pull_request`
  for a branch with an open PR (never filtered, so the required checks always report), and
  `workflow_dispatch` for a branch with no PR yet (`bun run ci:branch` sends it). A work branch no
  longer runs twice for one commit (on its push and on its PR). A push to main skips only
  `docs/images/**` (#235).
- **`bun run pr`** (scripts/lib/pr-flow.ts, through `gh api` only): `open` titles the PR after the
  issue the branch's subjects name most (or `--issue`) and writes `Closes #N` with the subjects;
  it opens no second PR for a branch. `next` lists the open PRs in merge order (onto main by number,
  a stacked PR right after its parent) with what each needs: its parent, a draft, failing, running
  or missing checks, or the commits it is behind. `update` is GitHub's update-branch. `merge` is the
  coordinator's (`FLIGHTDECK_COORDINATOR=1`) and merges with a merge commit, pinned to the HEAD it
  checked, only when the required checks are green there and the PR is not behind main.
- **The required checks come from the ruleset**, read by REST (`rules/branches/main`), not from a
  list in the code: the ruleset stays the only place that names them. A check counts as green the
  way GitHub counts it for a required check: success, skipped or neutral, on the newest run of its
  name, or a commit status of that name.
- **Not changed here:** handoff-ci (#221) checks for a push trigger on the branch; with this, a
  branch with a PR proves itself on its PR run instead, and handoff-ci has to read that run.
