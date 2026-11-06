# A PR runs the Windows tests and the journeys it can break (issue #399)

- **Why.** Two red mains on 2026-11-06 came from tiers that #309 had moved off the PR path.
  #392: #383 changed only `scripts/test/`. The path plan gave it no Windows shards, and the
  integration tests it broke ran on Windows only on main. #391: the e2e journeys ran only on main.
  This supersedes, in part, `2026-11-06-windows-pr-fast-tiers.md` and
  `2026-11-06-ci-e2e-off-the-pr-path.md`.
- **Windows (W).** On a PR the Windows shards now run the same selection as the Linux suite:
  - every unit and component test, plus the integration and e2e tests related to the changed files;
  - the whole suite when a file every test reads changed, or a test went away.

  `bun run test:related -- --pr --base origin/<base> --list selection.txt` writes the selection (a
  `*` line for the whole suite), and `bun run test:shards -- run <i>/3 --files selection.txt`
  shards exactly that list. There is no coverage gate on Windows; Linux holds the 100% gate.
  A change under `scripts/` now plans the Windows shards too. Before, only the daemon or a global
  file did.
- **The journeys (E).** The path plan has an `e2e` output. It is true for what the screens read
  (the app, the protocol, the dependencies, the workflow), for `scripts/e2e/`, for
  `scripts/lib/e2e*.ts` and `scripts/lib/demo*.ts`, for `scripts/demo*.ts`, and for `playwright*`.
  It is always true off a PR. The `screenshots (prints, axe e e2e)` check then needs the journeys
  green when they were planned, and skipped when not. A failing journey gets Playwright's one CI
  retry (`scripts/lib/e2e-config.ts`) and nothing more; the workflow adds no rerun.
- **Cost**, measured on green runs of 2026-11-06:
  - The PR's critical path is the suite plus SonarCloud, about 9.3 minutes.
  - Windows: most PRs add 0 to 2 minutes a shard. A global change runs the whole suite there,
    about 7 to 10 minutes a shard (414 to 588 s on main), so at most about 1 minute of wall time.
  - Journeys: 17 of the last 40 PRs touched their paths. Their three shards (about 95 to 430 s
    each) run beside the prints, under the critical path, for about 12 runner-minutes per PR.
- **Risk.** A journey flake now blocks a PR after its one retry, where before it only turned main
  red.
- The required check names do not change.
