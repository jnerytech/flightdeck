# CI in shards, with the required names kept (issue #220, part of #216)

- **Measured first.** On a green run (41960871352) `test (windows-latest)` took 33 minutes (25 of
  tests, 5 of cargo), `screenshots` 24 and `test (ubuntu-latest)` 15.
- **Linux stays whole.** Bun's lcov has per-line records but only a per-file function total, so
  shards cannot be merged for the 100% function gate without weakening it (an inline callback that
  never runs) or failing hub files every shard imports. `test (ubuntu-latest)` keeps the whole
  suite, the exact gate and SonarCloud.
- **Windows in three shards, without its own coverage gate** (the coordinator's choice). Each
  shard runs `bun test --shard=i/3`; the smokes, cargo, the bundle budget and the performance
  baseline run in `checks-windows`; Windows no longer repeats typecheck and lint, which are the
  same code on both systems. What is given up is only Windows' own guarantee that every line runs
  there (code behind a `skipIf(win32)`); Linux still requires 100%.
- **The ruleset's names are aggregates.** The main ruleset requires `test (ubuntu-latest)`,
  `test (windows-latest)`, `screenshots (prints, axe e e2e)` and `SonarCloud Code Analysis`. The
  Windows and screenshots checks are now small jobs with exactly those names that need their parts
  and fail unless each succeeded (`if: always()`, so a failed or cancelled part fails them rather
  than leaving them skipped).
- **Prints and e2e apart.** `screenshots-prints` and `screenshots-e2e` run side by side; a failed
  journey's trace and print are now their own `e2e-failures` artifact.
- **No timings file yet.** `bun test --timings` balances shards by duration, but a committed
  timings file would be one more file every branch touches; the shard count is tuned from the
  first runs instead.
- **`build:desktop` on Windows, found by `checks (windows-latest)`.** `vite.config.ts` imported
  `entryHtml` from `demo/boot.ts`, whose imports reach `lib/tabs.ts`, which imports the protocol
  since #198. On Windows Vite does not bundle that workspace package into the config (bun links it
  through a junction), so Node imports `packages/protocol/src` itself, and its type stripping stops
  at the parameter property of `PersonaModelError`. `entryHtml` moved to `demo/entry-html.ts`,
  which imports nothing, and a test keeps every workspace package out of what the config reaches.
  The `smoke:limits` failure of the first run did not come back on the rerun.
