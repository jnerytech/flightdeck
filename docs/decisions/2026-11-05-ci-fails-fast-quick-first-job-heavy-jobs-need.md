# CI fails fast: a quick first job the heavy jobs need (issue #272)

- **Why.** On 2026-11-05 ratchets (Sonar, layout, no-sync, protocol surface) failed only after
  the 20-minute jobs. A count that went up now fails the run in minutes.
- **The `quick` job** (`quick checks`, Linux, 10 minutes at most) runs typecheck, lint, the TDD
  audit (full history) and `bun run scripts/ci-quick.ts`: every `*-ratchet.test.ts(x)` and
  `protocol-surface.test.ts`, by name (scripts/lib/ci/quick.ts), in seconds with no coverage. The
  Linux suite no longer runs typecheck, lint and the audit itself.
- **Every heavy job needs it:** the Linux suite, the Windows shards and checks, the prints and the
  e2e shards.
- **No local Sonar in it** (#283): the `lint:sonar (ratchet)` step it first carried failed once main
  grew past the baseline, and the user chose SonarCloud's own check on the PR as the only Sonar
  check. #283 removes the local Sonar from the repository.
- **A failed quick job fails the required checks, never skips them.** GitHub counts a skipped
  required check as passed. So `test (ubuntu-latest)` runs on `!cancelled()` and its first step
  fails unless `changes` and `quick` succeeded. The two aggregates check `quick` before they pass a
  job group skipped by path. SonarCloud never reports when the suite did not run, so its required
  check stays missing.
- **The ruleset is unchanged:** `quick checks` is not a required check, and the four required
  names stay as they were.
- **Not in the quick job:** a guard checked inside a heavier test (`layout-guards.test.ts`) stays in
  the suite. Only a file named `-ratchet` is quick, so a slow test never slips in by itself.
