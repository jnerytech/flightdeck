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
  adding them). `test.skipIf(<platform capability>)` is fine. A flaky test that hurts CI may be
  skipped, on any platform (`test.skip`, `it.skip`, `describe.skip`) or off Ubuntu
  (`test.skipIf(notLinux)`, `scripts/test/not-linux.ts`), with `// unstable: #<issue> <reason>` on
  its line or the line above. The fix goes to that open issue. The hook, the TDD audit and the
  unstable-skip ratchet (at most 10) check the note, and CI's quick job fails once the issue is
  closed (#494), or on the PR that closes it while the skip is still in (#552). `toContain` on something that
  may be `undefined` takes `?? ""`.
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
