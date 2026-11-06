# The Windows unit-test shards are split by measured time (issue #292)

- **Why.** `bun test --shard=i/3` hands each shard a third of the files, whatever they cost: on CI
  (2026-11-05) Windows shard 1/3 took 9 to 12 minutes while the others took 5 to 8, and the leg
  waits for the slowest.
- **How.** `scripts/test-timings.json` holds the seconds each test file took (sorted keys, three
  decimals). `bun run test:shards -- run <i>/<n>` lists the tracked test files (`git ls-files`),
  sorts them slowest first and gives each to the lightest shard so far (the same input always gives
  the same split), then runs `bun test` on that shard's files with the JUnit reporter. A file with
  no recorded time weighs the median of the known ones, so a new test is never dropped: it is just
  placed by a guess until the next `record`. `plan <i>/<n>` prints a shard's files.
- **Refreshing the times.** `record` reads JUnit files and the plain log of a `bun test` run alike
  (`parseBunLog`: the `(pass)`/`(fail)` milliseconds under each `##[group]<file>:` line). Each
  Windows shard uploads its JUnit report (artifact `test-timings-windows-<i>`), and
  `bun run test:shards -- record junit-1.xml junit-2.xml junit-3.xml` moves the times of the files
  they hold and drops the files that no longer exist. The first file was seeded from the logs of
  the three Windows shards of main's run 42129496198 (`gh api repos/{owner}/{repo}/actions/jobs/<id>/logs`):
  the summed test times were 94 to 96% of each shard's wall time, so the per-file overhead is left
  out. Those times estimate the shards at 378, 378 and 378 s, against 541, 287 and 307 s under
  `--shard`. It is a balance, not a gate: stale times only make a shard slower.
- **Command line.** Each shard passes about 290 paths to `bun test` (about 14 KB), under the 32 KB
  Windows allows for a command line. If the suite grows past roughly twice that per shard, `run`
  must split its files into several `bun test` calls.
- **Left out.** The coverage run on Linux is one process, unsharded, and is not touched.
