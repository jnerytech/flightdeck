# The five unstable tests are fixed, none is skipped off Linux (issue #288)

*Superseded by [2026-11-08-skip-notes-retired.md](2026-11-08-skip-notes-retired.md) (#169): no note excuses a skip any more.*

Continues the entry on `skipIf(notLinux)` and its ratchet in `docs/DECISIONS.md` (the five unstable tests).

- **Four of the five are fixed (issue #288, 2026-11-05).** The hub-list ratio failed on Ubuntu CI too
  (249 ms against 229), so the skip off Linux did not save it. Now: hub-list compares counts (rows
  drawn, React commits, reads of the history) at 690 and at 9,090 rows, with no clock; wait-stays
  asserts at least two looks and that it returned no earlier than its window (`Date.now()` is what
  `stays` itself loops on); platform lint and proto-restore keep a 90 s limit that only bounds a hang.
  They lost their skip and note, and the ratchet maximum went from 5 to 1. Only the heartbeat test is
  still skipped: its fix needs a ticker and a clock injected into `startServer`
  (`performance.now()` and `setInterval` for the ping), so #288 stays open for it.
- **The fifth is fixed too (issue #288).** `ServerOptions` takes `now` (the heartbeat clock, default
  `performance.now()`) and `pingTicker` (runs the tick every `pingIntervalMs` and returns its stop,
  default a `setInterval`). The heartbeat test drives both by hand: before each tick a command
  arrives and no pong does, eight ticks in a row leave the client connected, then the clock moves to
  4 intervals minus 1 ms of silence (still connected) and to exactly 4 (closed with 4408). No timer
  and no wait on the clock. Mutants of the boundary (`>` for `>=`) and of the frame stamp both fail it.
  The ratchet maximum is 0, so no test is skipped off Linux; the `skipIf(notLinux)` form and its hook
  check stay for the next unstable test, which must name an issue.
