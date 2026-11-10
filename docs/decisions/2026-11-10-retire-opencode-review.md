# pr auto no longer waits for an OpenCode review (issue #1697)

## Context

Since #1526, `bun run pr -- auto <n>` read the PR's OpenCode review (`pr-reviews/pr-<n>.md`,
written by the coordinator's tooling through the `FLIGHTDECK_PR_OPENED` hook, #273) and refused to
merge an already-clean PR whose review was missing or said "changes" unless `--now` was given. On
2026-11-10 the user retired OpenCode for good: no review file is written any more, so that wait
could never end and every PR needed `--now`.

## Decision

- `pr auto` neither reads nor names a review. A clean, green PR merges as auto-merge would, under
  the same required checks (`mergeChecked`); the coordinator-only `merge` and `tag` are unchanged.
- A `--now` left in a command is accepted and said to be no longer needed.
- The review before a PR is the session's own `/code-review` and `/security-review` (#1670), plus
  the `security-reviewer` agent's `Security-Reviewed:` trailer where the security gate asks for it.

## Discarded

- **Keep the wait and read another review file.** Nothing writes one now; it would keep `--now` in
  every command for no check.
- **Gate `pr auto` on a trace of `/code-review`** (for example a commit trailer). Worth a separate
  decision: today nothing records that the skill ran, so the gate would check only a convention.

## Consequences

- `pr auto` and `pr update` can merge a clean PR at once. Nothing in code checks that the review
  skills ran; the rule lives in CLAUDE.md.
- `FLIGHTDECK_PR_OPENED` stays a generic hook. If the coordinator's environment still points it at
  an OpenCode script, that setting is the coordinator's to drop.
