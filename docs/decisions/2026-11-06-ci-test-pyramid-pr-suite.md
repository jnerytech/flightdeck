# A PR runs the base of the test pyramid; the whole suite runs on main and nightly (issue #309)

- **Why.** The user asked for shorter build and delivery times, gated by the cheapest tests. The
  whole suite (about 9-10 minutes on CI) gated every PR, and a merge waited for it.
- **The PR's suite job** runs `bun run test:related -- --pr`: every unit and component test (the
  tiers of `scripts/lib/test-tiers.ts`), plus the tests of the other tiers that reach a changed
  file through the import graph (transitively) or name it as a path. Every changed source file must
  be at 100% lines and functions from those tests (`scripts/lib/related-coverage.ts`, against the
  merge-base with the PR's base). The lcov stays in `coverage/` for SonarCloud.
- **The whole suite** (`bun run test`, the whole-repo 100% gate) runs on every push to main, every
  night (a `schedule` trigger) and on a dispatch. `pr tag` still needs main's full run green, so a
  release never goes out on a red whole-repo gate.
- **Unchanged:** the required check names, the quick job, the path plan. This is step (a) of #309;
  Windows, the e2e journeys, the coverage ratchets and the docs follow in their own PRs.
