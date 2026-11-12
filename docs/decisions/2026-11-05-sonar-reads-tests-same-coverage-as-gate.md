# Sonar reads the tests and the same coverage as the gate (issue #205)

- **Tests are test code in Sonar.** `sonar.exclusions` no longer lists the tests; `sonar.test.inclusions` (`**/test/**`, `*.test.ts(x)`,
  `scripts/e2e/**`) marks them, so Sonar runs its test-scope rules on them. In the SonarCloud TypeScript profile 381 rules are
  main-scope and 37 test-scope; `lint:sonar` runs each set on its kind of file (`testRules` in `scripts/sonar-profile.json`).
  The first local run found 120 test findings (116 generic assertions); they are fixed, and 4 profile rules still have no ESLint twin.
- **One list for coverage.** Sonar read 99.4% while the gate says 100% because the two exclusion lists differed (the build config, type
  declarations and `scripts/e2e` were counted by Sonar only). `scripts/test/ci/sonar-coverage.test.ts` now checks every tracked file:
  Sonar counts it for coverage exactly when `isCoverageSource` (the gate's rule) does, so the lists cannot drift. The properties file
  cannot call code, so it keeps its own glob list and the test is what ties it to `scripts/lib/coverage-gate/check.ts`.
- **Not verified here:** the scanner itself needs the token, so the overlap of `sonar.sources` and `sonar.tests` (with
  `sonar.test.inclusions` deciding) is proven by the next SonarCloud run on the PR, not locally.
- **`explicit-test-skip`.** The two tests that returned early on Windows use `test.skipIf(...)`.
