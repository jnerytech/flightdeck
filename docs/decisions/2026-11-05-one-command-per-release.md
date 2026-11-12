# One command per release (issue #275)

- **`bun run release vX.Y.Z`** (the coordinator's, `FLIGHTDECK_COORDINATOR=1`; it refuses without
  it and touches nothing) is a state machine over `origin/main`, so running it again carries on.
  Main behind the tag: a branch `release-vX` gets `test(versao)` (the version test moves first and
  must be red), `chore(versao)` (the three packages and `bun.lock`; the test must be green), the
  protocol-surface check (a lost baseline line stops the release) and, when `--write` changes the
  baseline, `chore(release)`; then the branch is pushed, a PR is opened (not through `pr open`,
  which would close the issue of its first commit) and `pr auto` turns on auto-merge. Main at the
  version: the surface check, `pr tag vX` (so the CI gate of #264 still decides) and
  `release:close -- vX --apply`. A tag that exists is not made again; the close still runs.
- **Why a state machine, not one blocking run.** The PR merges when its checks are green, which
  takes longer than a session should wait; the second run is the "after merge" half of the
  issue. Logic in `scripts/lib/release/cmd.ts`, effects injected, no test pushes or tags.
- **The hook guard knows `bun run release`** (#275, from the security review): the command pushes and
  tags through child processes the hook never sees, and its own check is the same environment flag,
  which a command can set inline. `prMergeViolation` now blocks `bun run release` and
  `bun scripts/release-cmd.ts` in a session, like `pr tag`.
