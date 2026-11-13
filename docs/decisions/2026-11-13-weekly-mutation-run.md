# Weekly mutation run on GitHub (issue #1607)

## Decision

`.github/workflows/mutation.yml` runs StrykerJS once a week (Sunday 03:23 UTC) and by hand
(`gh workflow run mutation.yml --ref main`). It never starts on a push, a pull request or a release,
so it gates no PR or release (it only turns red under a domain's `minScore`, see `2026-11-13-mutation-equivalent-survivors.md`); `scripts/test/ci/mutation-config.test.ts` keeps the triggers that way, and keeps
`ci.yml` and `release.yml` free of Stryker. It runs on a GitHub runner, not on the Pi: one file took
18 minutes there (see `2026-11-11-mutation-testing.md`) and the slot is shared.

`bun run mutation:weekly` (`scripts/mutation-weekly.ts`) reads `mutation-domains.json`, a list of
`{ name, mutate[], tests[], minScore? }`, and runs `stryker run` once per domain over the settings of
`stryker.config.json`. A domain's mutants are judged by that domain's own tests, never the suite.
There are no `domain/` folders in the tree yet, so the list is a file; a domain is added by naming
its source files and the test files that judge them. The by-hand `bun run mutation` stays as it was.

Each run is incremental: the incremental file of every domain is cached between weeks, so a week with
few changes re-judges only the mutants whose file or tests changed.

## Output

- The job summary: one row per domain with its score (killed and timed out over all counted mutants),
  the counts, and the first 40 survivors per domain as `file:line mutator → replacement`.
- The artifact `mutation-report`: `reports/mutation/summary.json` (scores and every survivor) and the
  full Stryker JSON of each domain.

## Next

A survivor that is a business rule becomes a test issue, not a rewrite of the file; string literals
no test reads are left alone. Widen `mutation-domains.json` one domain at a time, after the survivors
of the last one were read.
