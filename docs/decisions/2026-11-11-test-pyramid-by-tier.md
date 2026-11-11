# The test pyramid is explicit in every run (issue #1854)

- **Why.** The tiers exist since #261, computed from each test's content, but a run hid them: CI
  showed "test shard 1/3", and nobody could say how many minutes the integration tier costs. The
  unit and component tests also ran three times per PR: the shards ran them twice (Bun and
  istanbul), and the fast coverage job ran them again, only to get a lcov of the base.
- **Shards by tier.** The suite runs in four shards, named by tier in pyramid order: `unit +
  component 1/3`, `2/3` and `3/3`, then `integration 1/1` (a PR selects few integration tests: 0.5 s and 1.4 s measured on #1855, so the base gets three runners). The plan lives in
  `scripts/lib/tier-shards.ts`. A test file's tier still comes from its content; a file whose
  tier is unknown runs with the unit tests, so none falls out. The e2e tier keeps its own jobs.
  The jobs run in parallel, not one tier after the other: waiting for the base before starting
  the integration shards would add its minutes to the run, and the table below is how that cost
  is measured first.
- **The table.** The merge writes, per tier, the files, tests, summed test time and slowest file to
  the job summary, and the same rows as JSON (`pyramid.json`, the `test-pyramid` artifact, kept 30
  days) so the trend can be charted. A tier no job ran, as in a PR's selection, reads as a dash.
- **Fast coverage.** A PR runs every unit and component test, so the two `unit + component` shards
  hold the base's whole coverage. The merge judges the ratchet (`fast-coverage-baseline.json`) from
  those shards alone, with istanbul's functions merged exactly, and the `fast coverage` job reads
  that verdict in seconds. `bun run fast-coverage` stays for `--write` and local use.
- **Left for the next steps of the issue.** The table at the end of local runs, the shape row in
  `bun run arch`, and the e2e row's time.

## UI tests that start a daemon run on the component shards (#1854)

With one integration shard, the 77 UI tests that also start a daemon (they count as integration)
ran in one process with the other integration files and failed together on CI (menus not found,
waits timed out, in bun and istanbul alike); they pass next to the other DOM files. `shardTiers`
(`scripts/lib/test-tiers.ts`) places a test that draws the DOM on the component shards; the pyramid
table still counts it as integration, by `testTiers`.
