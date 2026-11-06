# A run on main always finishes (issue #326)

- **Why.** The CI workflow cancelled the run in progress of the same concurrency group on every new
  push. Each merge is a push to main, so between 00:07 and 02:51 UTC on 2026-11-06 fourteen main
  runs in a row were cancelled. There was no main result for three hours: red-main detection was
  blind, and `pr tag` found no green run to release from.
- **The rule.** `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. On main the run in
  progress finishes; GitHub keeps it and only the newest pending run of the group, so a burst of
  merges costs at most two runs. On a PR or a branch a new push still cancels its previous run.
- **The test.** `scripts/test/ci-branches.test.ts` pins the expression.
