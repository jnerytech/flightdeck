# On a PR the Windows shards run the unit and component tiers (issue #309)

- **Why.** After #292 the Windows leg was the slowest required check on a PR: three shards of
  about 400 s of tests each (by `scripts/test-timings.json`). The test pyramid puts the expensive
  tiers on main and nightly, as the Linux suite (#312) and the e2e journeys already do.
- **What runs where.** On a PR each shard runs
  `bun run test:shards -- run <i>/3 --tier unit,component`: about 70 s of tests a shard. On a
  push to main, the nightly schedule and a dispatch the shards run every tier, as before. Linux
  still runs, on the PR, the related tests of every tier, so a change to a process-spawning file
  meets its integration tests there; what waits for main is only the Windows run of them.
- **`--tier`.** It keeps the tests of those tiers before the split, so the shards stay balanced.
  A test no tier claims still runs (the rule of `test:related --tier`). The tiers are computed
  from every tracked source (`lib/test-tiers.ts`), because a test's tier follows the helpers it
  imports. A missing list or an unknown tier is the usage, exit 2.
- **The required check.** `test (windows-latest)` keeps its name and its rule: the three shards
  and the Windows checks must succeed. The timing file learns only from the files a run timed, so
  a PR's report never drops the times of the other tiers.
