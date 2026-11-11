# Commands

The full detail of the commands that `CLAUDE.md` summarizes (moved out of it word for word, #1973).

- A red main (#1246): `bun run main-red` lists what fails and who claimed it (a green run closes the claims);
  claim before fixing: `-- claim "<cause>"` (a second claim on an owned test is refused; pr open/update warn too).
- Test a single file: `bun --config=bunfig.area.toml test <file>`. A plain `bun test <file>`
  exits with 1 even when it passes, because of the global coverage threshold.
- Full suite (with the 80% line and function threshold per file, #1002): `bun run slot -- bun run test`.
- The heavy commands go through the slot: `bun run slot -- <command...>` (for example
  `bun run slot -- bun run test`). It is one exclusive lock for the whole machine, with a queue;
  waiters take it first come, first served. `bun run slot -- --status` shows the holder (with a
  warning past `--max-age`, 90 min by default) and each waiter in queue order with its age, folder
  and an `ORPHAN` mark. Past 20 min a hold is LONG for the holder, its waiters and `--status`, and
  harness:stats lists it; a run over 60 s of CI time by `scripts/test-timings.json` needs
  `FLIGHTDECK_SLOT_HEAVY="<reason>"` (#833, #1541). A waiter whose shell is gone gives up (`FLIGHTDECK_SLOT_DETACHED=1` keeps a
  launch detached on purpose in the queue), and `--reap` (the coordinator) stops orphan waiters by
  process group, never the holder. `--nice` lowers the command's priority, `--cancel` stops your own waiters and run
  (matched by `FLIGHTDECK_SLOT_LABEL`, never another session's), so nobody needs `pkill -f`.
  `--priority` (for the maintainer's full gate) also lowers the other bun test processes of the
  user while it runs. What the slot and the light lane start, and every test run (the preload),
  runs at `oom_score_adj` 1000 on Linux, so the kernel kills a leaking test before any session.
- Tests for what you changed: `bun run test:related [--base <ref>] [--fast]`. It takes the files
  changed since the merge-base with `main` (or `<ref>`), picks the changed test files plus every
  test that imports a changed file (transitively; with `--fast`, only directly) or names it as a
  path, prints each with the reason, and runs them in one call (through the slot above 60 files). The run also collects coverage and fails unless every
  changed source file is at 80% of its lines and functions, listing the uncovered `file:line` and the
  uncalled functions (`bunfig.related.toml`; the same exclusions as the full suite). A file that a
  changed test newly imports is held to 80% too, with the tests that import it directly, since
  loading it puts it in the full suite's gate even outside `scripts/lib` (#762; direct imports only,
  not what that file loads in turn). `--pr` (#309) is what a PR's
  CI runs: every unit and component test plus the related tests, with the same changed-file gate, or
  the whole suite when a global file changed or a test went away; `--keep-coverage <dir>` keeps the
  lcov there. A change to `package.json`, a `bunfig` or the preload
  prints a warning: run the full suite then. A worker session runs it with `--fast` or `--tier`
  (#674): the guard hook refuses a plain, `--base` or `--pr` run, through the slot or not, since it
  holds the slot 12 to 25 minutes for what the PR's CI does anyway. `FLIGHTDECK_SLOT_HEAVY="<reason>"`
  as an env prefix of the run itself lets a real need through (#687: anywhere else in the command it
  does not count, and a reason has at least 8 characters); `harness:stats` counts the refusals and
  the overrides.
- Tests by tier (#261, computed from each test's content): `unit`, `component` (the DOM), `integration`
  (processes, a server, real git) and `e2e` (journeys, smokes). On the Pi, a session runs
  `bun run test:related -- --fast --tier unit,component` (a fifth of the suite's time, no coverage
  gate). A PR's CI runs `--pr`: every unit and component test plus the related tests of the other
  tiers, with 80% on the changed files. A push to main runs the same, from the commit before it
  (#444). The e2e journeys run when the change touches what they read (the screens, the journeys,
  the demo, the daemon). Windows is not part of a PR's or a push's run (#534): the person tests it
  by hand. The schedule (every 3 hours) and a run by hand run the whole suite with the whole-repo
  80% gate (on Linux, 3 shards × Bun lines and istanbul functions, merged fail-closed by
  `scripts/shard-gate.ts`, #296), Windows included as a signal that gates nothing (`test:shards`, 30 s per test there);
  `pr tag` tags only a commit with such a full green run. `bun run test:tiers` prints the counts.
- Which function a file is missing: `bun run coverage:funcs <file.ts>... [--tests <test.ts>...]` runs
  the tests that reach the files (or the ones named after --tests) and lists the functions no test
  called as `file:line`. Bun's coverage only counts them. It instruments in memory, never the sources.
  A worker session runs it over at most 20 test files (#674): more is refused, by the guard hook
  for `--tests` and by the script for the tests it picks, with the same override. The script refuses
  for every session, the coordinator too (#725): its environment is the command's, which a worker can set.
- Sonar: SonarCloud analyses each PR and each full run of main, never a main push (#283, #296);
  `bun run sonar-left` lists the open findings, `STALE?` where main changed since (#1477). `// NOSONAR: <reason>` on the flagged line suppresses a reviewed false
  positive there. `sonar-project.properties` keeps SonarCloud's coverage on exactly the files of
  the coverage gate (`sonar-coverage.test.ts`).
- Before hand-off from a session: `bun run handoff:check` runs `typecheck`, `lint`, `tdd:audit`
  and `test:related` in order, then reads the required checks of HEAD on GitHub (`ci=`: push the
  branch first; `--base <ref>` for a branch stacked on another) and the security gate (`security=`,
  #273: a change that spawns or kills, deletes, handles a secret or a permission, or touches the
  vault or pairing needs the `security-reviewer` agent's verdict committed after it, as a
  `Security-Reviewed: <summary>` trailer), and prints a `HANDOFF <branch> <head> ...` stamp line; paste it in the hand-off message. The receiver runs
  `bun run handoff:check -- --verify` in the worktree (refused when stale or not all 0, `ci` too). The full suite (`bun run slot -- bun run test`) runs at the
  orchestrator's version gate and in CI, not in every session.
- Format: `bun run format`. Smokes: `bun run slot -- bun run smoke:<name>` (list in
  `package.json`; never `smoke:real` unless asked).
- Audit: `bun run tdd:audit` audits from the merge-base with `main` (or from the last tag on
  `main`), the same as `-- --since auto`; `-- --since <tag or commit>` picks the start. CI runs it.
- Screens: `bun run demo` (the fake hosts and the web entry at http://localhost:1420; `DEMO_PORT` picks
  another, and the e2e run and `demo:shots` take a free one, so an open demo never blocks them;
  `DEMO_BUILD=1` serves a production build through `vite preview`, as CI's e2e and prints do, #444),
  `bun run slot -- bun run demo:shots` (prints in both themes and languages, plus axe),
  `bun run slot -- bun run e2e` (the
  journeys, in both languages, with `@playwright/test`: `E2E_ONLY=a,b` picks journeys, and
  `bun run slot -- bun run e2e -- --repeat-each 5` hunts flakes; the HTML report is in `playwright-report/`).
- Builds: `bun run slot -- bun run build:daemon`, `bun run slot -- bun run build:desktop`.
  `cargo check` (in `apps/desktop/src-tauri`) requires the desktop build first.
