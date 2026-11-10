# Unstable tests are skipped off Ubuntu, in the code (issue #288)

- **The user's call (2026-11-05):** "pode skipar todos, exceto os testes do ubuntu", and "skip tests in
  the code" when asked how. Windows failed on every PR and on main, and `test (windows-latest)` is a
  required check, so five tests that bet on the machine blocked every merge. A first version put them
  on a quarantine list that the required jobs left out by name, with a non-blocking job; it was
  dropped before it merged, because the skip in the code is simpler (no list, no runner scripts, no
  job, `ci.yml` unchanged) and keeps the test where its author reads it.
- **The form:** `test.skipIf(notLinux)(…)` with `// unstable: #<issue> <reason>` on the line or the
  line above (`scripts/lib/unstable-skip.ts`). The tests are untouched otherwise and still run on
  Ubuntu under the 100% gate. A skip for a platform *capability* is a different thing and needs no
  note.
- **What `skipIf` was before:** the hook never blocked `skipIf` (its markers are `.only(`, `.skip(`,
  `test.todo(` and `toMatchSnapshot(`), and ten capability skips exist. So nothing was loosened:
  the new rule *adds* a check for the off-Linux form (an Edit or Write that adds one without the
  note is blocked), and `.skip`, `.only`, `test.todo` and snapshots stay blocked whatever comment
  is next to them.
- **The ratchet** (`unstable-skip-ratchet.test.ts`): every skip off Linux has the note with an issue
  number and a reason, and there are at most 5 (the five below), the number only lowered. Whether
  the issue is still open is not checked (the tests touch no network): close #288 only when the
  last skip is gone.
- **The five:** hub-list "the render time at 9,090 rows is within 2x…" (a ratio of two wall-clock
  render times); heartbeat "qualquer quadro do cliente conta como vivo…" (10 ms and 25 ms timers
  against a 75 ms silence limit); platform "lint barra @tauri-apps/*…" (spawns biome; over 15 s on a
  loaded Windows runner in three runs); proto-restore "two files that patch HTMLElement.prototype…"
  (a child `bun test` with the whole preload; over 15 s on Windows); wait "it returns once the window
  ended…" (counts polls in an 80 ms window). The fixes (counts instead of a ratio, an injected ticker
  and clock for the heartbeat, a longer hang limit for the two child processes) are parked on the
  branch `timing-fixes-288` for #288.
- **Known limits (security-reviewer pass, nothing high):** the hook is a guard against slips, not a
  boundary. It recognises `notLinux` and `process.platform !== "linux"` (also `'linux'`) on one line;
  it does not see `!=`, a backtick string, an alias of `notLinux`, `skipIf(true)`, a skip in a helper
  that is not a `*.test.ts`, or `scripts/test/not-linux.ts` changed to `true`, and it takes any
  `// unstable: #<n> <word>` on the line (not a lookup of the issue, which needs the network). The
  ratchet bounds the first kind: it is exactly saturated (at most 5 and the five files named), and
  it runs in CI over the whole checkout. The hook matcher also covers only Edit, Write and Bash, as
  before. All of it is how the guard already worked for `skipIf`, which it never blocked.
