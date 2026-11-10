# The hand-off stamp vouches for CI, and a tag needs a green full run (issue #266)

- **What survived of #221.** Its push-trigger requirement and the `gh run list --commit` check
  died with GitHub Flow (#260). Kept: `test:related` compares with the audit base (origin/main
  first, the local main only as a fallback), and `handoff:check --base <ref>` for a branch stacked
  on another.
- **`ci=` in the stamp.** After the four local checks, `handoff:check` reads the main ruleset's
  required checks on HEAD (`headCi` in scripts/lib/pr-flow.ts, the same verdict `bun run pr`
  uses), whatever event ran them: a PR's run or main's push. `0` when green; otherwise `failed`,
  `pending`, `none` (never run: push the branch, or open its PR) or `unknown` (the ruleset could not
  be read). `--verify` needs `ci=0` like every other field; `--no-ci` writes `ci=skip`, which
  vouches for nothing. The stamp's pattern takes word values and still splits its pairs one way
  only (the #232 ReDoS test keeps it linear).
- **`bun run pr -- tag vX [--commit <sha>]`** (the coordinator's): a commit on main (main's HEAD by
  default) is tagged only after its full CI run on main (its push run, which plans everything,
  #264) completed with success. It refuses a tag that exists, a commit not on main, no run, a run
  still going or a failed one, and writes nothing then. The tag is pushed alone as `refs/tags/vX`:
  a push of several tags at once starts no workflow.
