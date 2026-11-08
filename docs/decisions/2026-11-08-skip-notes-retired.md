# No note excuses a skip any more; a platform skipIf passes (issue #169)

**Decision (fd-coordinator, 2026-11-08):** after #1003 deleted the last `// unstable: #N` skip, the
note no longer lets a `.skip(` through. The guard hook and `tdd:audit` refuse the same markers
(`.only(`, `.skip(`, `test.todo(`; the hook also refuses a first-run `toMatchSnapshot(`). A
`test.skipIf(<platform condition>)` passes in both. The unstable-skip ratchet,
`scripts/unstable-issues.ts`, its CI step and the quick job's `issues: read` are removed.

**Accepted on purpose:** nothing checks a `skipIf`'s condition or that its reason comment is
there. The old hook refused an off-Linux `skipIf` with no note. A skip off Linux still runs on
CI, which is Linux only and gates every PR, so it hides nothing there; Windows does not gate
(#534). A `skipIf` that is true on Linux would hide a test. No static check tells a real platform
condition from one that is always true, so the rule in `docs/TDD.md` (a flaky test is deleted, a
platform skip names its reason) and review cover it. Requiring the comment would also have made
the audit fail on the 30 platform `skipIf` lines already on `main`.
