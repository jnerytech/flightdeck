# Prints and axe in four jobs, one per theme and language (issue #291)

- **Why.** After #293 the one prints and axe job (13-15 minutes) was the longest of a PR, and every
  merge waits for the screenshots check.
- **The split.** `screenshots-prints` is a matrix of the two themes and the two languages, with
  `fail-fast: false`. Each job runs `bun run demo:shots` with `SHOTS_THEME` and `SHOTS_LANG`
  (`scripts/lib/shots/variants.ts`: all four pairs when unset, so a local run prints them all) and
  uploads its own `prints-<theme>-<lang>` artifact. A filter that names no known pair refuses the
  run instead of printing nothing. The required `screenshots (prints, axe e e2e)` aggregate is
  unchanged: the matrix job's result is every pair's. The filter is checked before Chrome starts. For the visual
  check a leg is still a complete run of its pair: a baseline with no print is reported inside the
  folders the leg printed (`pairs`), so no leg turns the check off once it moves to `compare`; only
  `DEMO_SHOTS` (some screens) does.
- **Not here: the e2e shards.** Shard 1 takes 7-11 minutes and the others seconds because the
  journeys are one file whose tests share the seeded demo, the second language relying on the
  first one's state (`workers: 1`, `fullyParallel: false`). Balancing them means splitting the
  journeys into independent tests, which is #292, not a one-line change.
