# A sort with no compare function fails lint (issue #322)

- **Why.** SonarCloud's S2871 failed #224, #308 and #311 on one night, each for a `.sort()` with no
  compare function, and nothing caught it before CI once the local Sonar copy was gone (#283).
- **The rule.** Biome's own `lint/suspicious/useArraySortCompare` is an error for the code under
  `apps/`, `packages/` and `scripts/`, so `bun run lint`, `handoff:check` and the quick CI job
  catch it. Use a compare function: `byCodeUnit` from `@flightdeck/protocol` for strings in code
  order, or `(a, b) => a - b` for numbers.
- **Tests are left out** (their folders, `*.test.ts(x)` and `scripts/e2e/`): Sonar does not apply
  S2871 to test code, and 118 test sorts would need changes for nothing.
- `scripts/test/sort-compare-lint.test.ts` lints three probe files: a bare sort in code is flagged,
  a sort with a compare function and a bare sort in a test are not.
