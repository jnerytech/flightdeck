# A sort with no compare function fails a test (issue #322)

- **Why.** SonarCloud's S2871 failed #224, #308 and #311 on one night, each for a `.sort()` with no
  compare function, and nothing caught it before CI once the local Sonar copy was gone (#283).
- **The rule.** `scripts/test/sort-compare.test.ts` scans every file Sonar analyses as main code
  (`sonar-project.properties`: tracked code under `apps/`, `packages/` and `scripts/`, minus the
  test inclusions and the exclusions) and fails on each `.sort()` or `.toSorted()` with no compare
  function, as `file:line`. Use `byCodeUnit` from `@flightdeck/protocol` for strings in code order,
  or `(a, b) => a - b` for numbers. CI runs it on every PR, with the other unit tests.
- **Why a text scan.** Biome's `lint/suspicious/useArraySortCompare` needs the array's type and
  missed six sorts of inferred string arrays (`readdir` results, filtered names). It stays an
  error in the same files, because the hook that runs Biome after each edit reports it at once.
  `bareSorts` (`scripts/lib/sort-compare.ts`) blanks comments first: a comment opens at the line
  start or after a space, so a glob such as `**/*.ts` or a URL never hides the code after it.
- **Tests are left out:** Sonar does not apply S2871 to test code, and 118 test sorts would need
  changes for nothing.
