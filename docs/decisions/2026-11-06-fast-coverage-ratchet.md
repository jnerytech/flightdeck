# The base of the test pyramid only grows (issue #309)

- **Why.** A PR now runs the fast tiers plus the related tests, so coverage could move unnoticed from
  the cheap unit and component tests to the slow integration ones. The base of the pyramid has to
  hold on its own.
- **The ratchet.** `fast-coverage-baseline.json` lists every source the unit and component tiers
  alone cover at 100% lines and functions. `bun run fast-coverage` (through the slot locally) runs
  only those tiers with coverage. A listed source below 100% fails, and the run names it. A newly
  covered source is a gain, which `--write` adds. `--write` refuses while a listed source dropped,
  so the list only grows.
- **Where it runs.** The `fast coverage (ubuntu-latest)` job runs it on main, nightly and by hand,
  not on a PR, because a PR's run mixes in integration tests and cannot tell. It is not a required
  check; a red main blocks `pr tag` until a fix lands.
- **The whole repo.** The whole-suite 100% gate already runs on main and nightly (#312), so that
  ratchet is already at its maximum and needs nothing more now.
