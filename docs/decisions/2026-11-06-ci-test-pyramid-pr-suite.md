# A PR runs the base of the test pyramid; the whole suite runs on main and nightly (issue #309)

- **Why.** The user asked for shorter build and delivery times, gated by the cheapest tests. The
  whole suite (about 9-10 minutes on CI) gated every PR, and a merge waited for it.
- **The PR's suite job** runs `bun run test:related -- --pr`: every unit and component test (the
  tiers of `scripts/lib/test-tiers.ts`), plus the tests of the other tiers that reach a changed
  file through the import graph (transitively) or name it as a path. Every changed source file must
  be at 100% lines and functions from those tests (`scripts/lib/related-coverage.ts`, against the
  merge-base with the PR's base). The lcov stays in `coverage/` for SonarCloud.
- **When the PR runs the whole suite instead:** a change to a file every test reads (`package.json`,
  `bun.lock`, a bunfig, a tsconfig, the test preload), or a test file that went away (a rename
  counts: the diff runs with `--no-renames`). Either can lower coverage of files the PR did not
  touch, which only the whole-repo gate sees.
- **SonarCloud on a PR** reads that partial lcov. Its quality gate judges new code, which the
  changed-file gate already holds at 100%; the overall figures on a PR look lower than on main.
- **The import graph** resolves `.`, `@/` and every `@flightdeck/<package>` (whole or by subpath),
  so no internal import falls out of the selection.
- **The whole suite** (`bun run test`, the whole-repo 100% gate) runs on every push to main, every
  night (a `schedule` trigger) and on a dispatch. `pr tag` still needs main's full run green, so a
  release never goes out on a red whole-repo gate.
- **Unchanged:** the required check names, the quick job, the path plan. This is step (a) of #309;
  Windows, the e2e journeys, the coverage ratchets and the docs follow in their own PRs.
