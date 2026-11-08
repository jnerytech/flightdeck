# No note excuses a skip any more; a platform skipIf passes (issue #169)

**Decision (fd-coordinator, 2026-11-08):** after #1003 deleted the last `// unstable: #N` skip, the
note no longer lets a `.skip(` through. The guard hook and `tdd:audit` refuse the same markers
(`.only(`, `.skip(`, `test.todo(`; the hook also refuses a first-run `toMatchSnapshot(`). A
`test.skipIf(<platform condition>)` passes in both. Two forms are refused in both (#1057
review): a `skipIf(true)` (or `1`, `!0`), and a `skipIf(notLinux)` or
`skipIf(process.platform !== "linux")` with no reason in a comment on its line or alone on the line
above, since that was how a flaky test was hidden off Linux. The unstable-skip ratchet,
`scripts/unstable-issues.ts`, its CI step and the quick job's `issues: read` are removed.

**Accepted on purpose:** any other `skipIf` condition passes with no comment check. No static check
tells a real platform condition from one that is true on Linux through a variable, so review
covers it. The reason comment is required only off Linux: 31 of the platform `skipIf` lines already
on `main` (Windows, POSIX, 8.3 names) have none, and the audit reads every test file.
