---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Tests (the full rules are in docs/TDD.md)

- Red by assertion: a stub with the real signatures returns wrong values (`""`, `[]`, `false`,
  `null`), never `throw`. Run one file with `bun --config=bunfig.area.toml test <file>`.
- No `.only`, `test.todo`, and no `toMatchSnapshot` on the first run (the guard hook refuses
  adding them). `test.skipIf(<platform capability>)` is fine. `toContain` on something that may
  be `undefined` takes `?? ""`.
- Tests aim at business logic and the important flows: the coverage gate is 80% of each file's
  lines and functions (#1002), not 100%. Do not write a test only to reach a line.
- A flaky test is deleted, never skipped. When it is the only check of a business flow, replace it
  with a fast deterministic one (#1003). No note excuses a `.skip(`: the hook and the TDD audit
  refuse every one (#169). A test that cannot run on a platform uses `test.skipIf(<the platform
  condition>)`, with the reason in a comment.
- Too slow on CI: a test over 5 s, a test file over 60 s, an e2e journey over 90 s. Make it faster,
  or delete it when it checks nothing a faster test does not. CI's slow-test check fails a PR on a
  test over 5 s or a file over 60 s (from the run's JUnit times) unless `slow-tests-allowlist.json`
  names it with its issue; add an entry only for a test an issue is already cutting.
- Nothing real: the preload puts a sentinel `claude` first on the PATH and points `HOME` at a
  temporary folder. Other CLIs (`gh`, `az`, `ssh`) are fakes on the test PATH, with a `.cmd` twin
  for Windows. No network.
- Waits come from `apps/desktop/test/wait.ts`: `settle` (it throws, naming what it waited for),
  `settleMaybe`, `stays`, `uiIdle`. Never a `settle`, `waitFor` or `until` of your own (the wait
  ratchet), and never a guessed sleep (the lazy-wait ratchet), except an
  `act(() => Bun.sleep(…))` with a `// timing:` comment saying why the clock is under test.
- Any fixed sleep (`Bun.sleep`, a promise on a timer, `sleep(`/`delay(`) is counted by the sleep ratchet
  (`sleep-baseline.json`, only down); a `// timing:` comment above it allows one. The preload resets
  timers, `Date`, `fetch`, env and the DOM state between files and names a file that leaked one.
- A file that `mock.module`s a project module captures the real one first and restores it in
  `afterAll`: Bun's module mocks outlive their file.
- Fixed ports are refused: a server in a test asks for port 0.
