# Fewer CI jobs per PR run (issue #444, part 1)

- **Why.** Runner concurrency is now the bottleneck: at one point 2 runs were in progress and 11
  were queued, with 14 PRs open. A full PR run was 17 jobs (run 42199415546: about 38 runner-min,
  with a longest job of about 5 min), so it took most of a 20-job pool alone. The job count per run
  is the lever, more than the minutes.
- **The plan is the first step of `quick`.** The `changes` job (7 s) is gone. Every heavy job
  already waited for `quick`, so this costs no wall time. The aggregates check `quick`'s result
  before they read its outputs, because a failed plan has no outputs and must fail the check,
  never read as "skipped".
- **One Windows shard on a PR.** A shard was about 40 s of setup and 86 s of tests. The plan's new
  `windows_shards` output is `[1]` on a PR, and `[1,2,3]` when the whole suite runs: a file every
  test reads changed (`GLOBAL_FILE` of `test:related`), a test went away, or the run is off a PR.
  The matrix reads it with `fromJSON`, and the shard step uses `strategy.job-total`.
- **Result.** A typical PR run drops from 17 jobs to 14. The required check names do not change.
- **Not done here.** Merging the four print jobs into two waits for a measured run. Printing is
  about 95% of each job (279 of 284 s), so a plain merge would add about 4.5 min of wall time.
  The cheaper main push is part 2, in its own PR.
