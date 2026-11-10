# The Linux leg in parallel jobs, the suite still whole (issue #293)

- **Why.** `test (ubuntu-latest)` took 12-18 minutes: the coverage suite (8 minutes, one process),
  then SonarCloud (4), then the smokes and cargo (3 on main), one after another in one job.
- **The split.** `test-suite` runs `bun run test` (the exact 100% line and function gate) and uploads
  `coverage/lcov.info`; `sonar` downloads it and runs the scan; `checks-linux` runs the smokes and
  cargo in parallel with the suite, only when the path plan asks for them. The required check
  `test (ubuntu-latest)` is an aggregate over the five (the plan, quick, the suite, SonarCloud, the
  checks), so the ruleset is unchanged; it checks the plan and quick first, since GitHub counts a
  skipped required check as passed. SonarCloud may be skipped (a dispatch); the checks only when the
  plan needs no smoke and no cargo.
- **Why the suite is not sharded** (measured 2026-11-05, three coverage shards on the Pi): lines
  merge exactly (every file has the same lcov line set in each shard), but bun's lcov counts
  functions per file without naming them, and even the count varies by process (it counts the
  functions a process compiled: 271 files differed). 111 of 595 files could not be settled from the
  counts. Sharding with the exact function gate needs named function data (#296, istanbul maps);
  the merge logic for that stays on the ci-ubuntu-shards branch.
