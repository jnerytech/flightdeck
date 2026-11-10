# Test isolation (issue #274)

- **Between files, not between tests.** Bun's preload `beforeAll`/`afterAll` run once for the whole
  run and `expect.getState().testPath` does not exist in 1.4.4, so the preload has no hook at a file
  boundary. It registers a `Bun.plugin` `onLoad` for `*.test.ts(x)`: Bun loads a file, runs it, then
  loads the next, so the load of file N is the end of file N-1. There the preload (`scripts/test/
  isolation.ts`) restores what a file can leave changed for the next one: `setTimeout`,
  `clearTimeout`, `setInterval`, `clearInterval`, `setImmediate`, `clearImmediate`, `Date`, `fetch`,
  the environment, and (once happy-dom is registered) the window size, `localStorage`,
  `sessionStorage` and `document.body`. The first snapshot is taken at the end of the preload, after
  the guards, so their PATH, HOME and fetch wrapper are part of the baseline.
- **The baseline is taken after each file has loaded, not before.** The plugin appends a call to
  the file's source, so it runs once the file's top-level code has. A helper that sets an env
  variable (`board-helpers.ts` sets `GIT_AUTHOR_*`) or registers happy-dom (which swaps the timers
  for its own) when it loads runs once, because Bun caches the module; restoring the state from
  before the first file would have taken that away from every later file (the first version did:
  1132 tests failed with `Author identity unknown` in the full run, each green alone). So only what
  a file's tests and hooks change is put back; what its top-level code set stays.
- **Named, not silent.** A leak other than the routine browser state (size, storage, body: nearly
  every UI file leaves some) prints `isolation: <file> left … changed; put back before <next>` on
  stderr, so the culprit is one line away. The reset is a net, not a licence: fix the file.
- **Not reset:** location, `matchMedia` (follows the viewport), `process.cwd()`, other globals a file
  defines, module state and `mock.module` (a file restores its own mocks, see the tests rules).
- **Sleep ratchet.** `sleep-baseline.json` counts `Bun.sleep`, `Bun.sleepSync`, a promise resolved
  from a timer and calls of a `sleep`/`delay` helper per test file (the four test folders, test
  files only: a fake binary sleeps on purpose). A `// timing:` comment on the line above allows a
  sleep where the clock is under test. It only goes down: a file may not exceed its entry.
  Baseline when added: 113 files, 251 sleeps.
