# A push to main runs the related selection; the full run is every 3 hours (issue #444, part 2)

- **Why.** Over 6 hours on 2026-11-06, main had 60 push runs. 41 were pending runs replaced by a
  newer one, at 0 runner-min. 17 finished, at about 90 runner-min each, for 1513 runner-min: about
  31% of all CI minutes, with every job running to its end whether it passed or failed.
- **A push to main plans like a PR.** The plan's new `base` output is:
  - the PR's target branch on a PR;
  - the commit a push to main came after (`github.event.before`) on a push;
  - empty for the schedule and a run by hand.

  When `base` is set, the jobs come from the paths, and the Linux suite and the Windows shards run
  `test:related --pr --base <base>`. A file every test reads, or a removed test, still runs the
  whole suite. A diff that cannot be read plans everything.
- **The full run is every 3 hours** (`17 */3 * * *`) and by hand. That is about 8 full runs a day
  instead of about 70. All the main reds of 2026-11-06 were caught by full main runs, so nightly
  alone would be too late.
- **The release gate.** `pr tag` tags a commit only after a full green run of it: the schedule's,
  or a dispatch whose test suite ran and passed. A run that failed or is still going is never
  skipped over. Otherwise, without `--commit`, it tags the newest commit with the bump and a full
  green run. With none, it starts a full run of main (`gh workflow run ci.yml --ref main -f
  only=all`) and asks to run `pr tag` again when that run is green.
- **Windows shards.** A PR or a push gets three Windows shards when more than 100 integration and
  e2e test files are selected (#483). Every selection holds the ~600 fast-tier tests, which one
  shard runs in minutes. #479's change to `app-store.ts` selected 1021 files, about 420 of them
  slow. Batching (#487) keeps each command line short inside every shard.
- **Risk.** A red that only the full suite sees now shows within 3 hours, or before a tag, instead
  of right after the merge.
- **Security review, low findings kept as they are:**
  - A full green schedule run on a commit outweighs a red partial push run of the same commit,
    because the full suite holds every test of the selection.
  - `--commit` is not checked as a full sha. It is coordinator-only and fails closed.
  - A push run that a newer push replaced leaves its commit out of every selection. The 3-hour
    full run covers it, and the release gate never relies on push runs.
