# Testing strategy after Khorikov: observable behavior, the code quadrant, mocks at the edge (issue #1604)

The structure moves of #1589 split files and rename folders. Tests that know where code lives or
how it is built go red on every move, and a red that is not a bug teaches people to ignore reds.
This file records why `docs/TDD.md` ("What a test checks") adopts Vladimir Khorikov's strategy.

## Decision

- Tests check observable behavior through the public entry of a domain, never implementation
  details. A unit is a unit of behavior (the classical school), not a class or a file.
- Many unit tests for domain rules and algorithms; few integration tests for controllers and
  wiring; complex code full of I/O is split first (Humble Object); trivial code is not tested alone.
- Mocks only for unmanaged out-of-process dependencies (`gh`, `claude`, `az`, `ssh`, webhooks: the
  fakes on the test PATH). Managed dependencies (our SQLite, our files) run for real. Types we do
  not own are wrapped by our adapter, and the adapter is what a test fakes (#1612).
- Output-based tests first, then state-based, then communication-based.
- The `test-quality-reviewer` agent flags implementation-detail tests, mocks of managed
  dependencies and leaked domain knowledge.

## Sources

| Source | Principle | What it means here |
|---|---|---|
| Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* (2020) | Four pillars; resistance to refactoring is not traded | A test that breaks on a move is a false positive, and the move PRs (#1523, #1593) must not touch assertions. |
| Khorikov, ch. 5 | Observable behavior vs implementation details | Assert results, stored state read through the API, and messages to the outside; never private functions or call order inside a domain. |
| Khorikov, ch. 7 | The code quadrant; Humble Object | Domain code gets unit tests, controllers integration tests; `main.ts` and the handlers stay thin so they need few. |
| Khorikov, ch. 8 and 9 | Managed vs unmanaged dependencies; mock only at the edge; don't mock what you don't own | Our SQLite runs for real in tests; `gh` and `claude` are fakes on the PATH; the anti-corruption adapters of #1612 are the seam. |
| Khorikov, ch. 11 | Anti-patterns: private methods, exposed state, leaked domain knowledge, code pollution, ambient time | Expected values are literals; the clock is injected (`now` in the deps object). |
| Gerard Meszaros, *xUnit Test Patterns* (2007) | Humble Object | The pattern the quadrant uses to split overcomplicated code (#1605). |

## Alternatives not taken

- **The London school** (a unit is a class, every collaborator mocked): every split of `board.ts`
  or `main.ts` would rewrite the mocks, the opposite of what the moves need.
- **A coverage target as the goal:** coverage stays a negative indicator; the 80% gate (#1002)
  stands as a floor on business flows.

## Consequences

- A move PR changes a test only in its import path; any other test change is its own commit, and
  a characterization test added before a split is its own commit too (#1602).
- New tests of a domain go through its `index.ts`, so they survive the domain's internal moves.
- Existing tests are not rewritten in bulk: they move toward this as their code is touched.
