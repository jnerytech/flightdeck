# Waits that throw (`esperas`) (issue #1711, moved from DECISIONS.md)

- A test wait that runs out of time used to return silently (about 106 local copies of
  `settle`), so the next assertion failed far from the cause: the failed-server test, and a
  `region(...)?.querySelector(...) !== null` that is true when the region is absent, each cost
  hours. `apps/desktop/test/wait.ts` now holds `settle` (inside `act`), `settlePlain` (no React),
  the factories `waiter(ms)` and `plainWaiter(ms)` (a file keeps the default timeout it had) and
  `settleMaybe` for waits that may end without the condition. A timeout throws `WaitTimeout`:
  `timeout (5000 ms) waiting for: <label or the check's source>`.
- `scripts/migrate-esperas.ts` (tested in `scripts/lib/migrate-esperas.ts`) swapped the own
  `settle` of 132 desktop test files for the shared one. `wait-baseline.json` and
  `scripts/test/guards/wait-ratchet.test.ts` count the test files' own waits (8 left, in odd shapes) and
  only let the number go down.
- This replaces the old rule "helpers that throw a timeout count as an error": a wait that times
  out is a failure of the wait, with its own message.
