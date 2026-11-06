# A flaky test may be skipped under its open issue, on any platform (issue #494)

- **Why.** The owner's words, relayed by fd-coordinator and confirmed in fd-harness's session on
  2026-11-06: "testes intermitentes que prejudicam o CI pode dar skip". Flaky UI tests, such as
  `keep-awake-ui` (#484) and `paleta` (#492), kept PRs red for reasons outside them.
- **The rule.** `test.skip(…)`, `it.skip(…)` and `describe.skip(…)` are allowed on any platform,
  as `test.skipIf(notLinux)` already was off Ubuntu (#288). Each needs `// unstable: #<issue>
  <reason>` on its line or the line above, and the issue is where the fix goes.
  - `.only`, `test.todo` and a first-run `toMatchSnapshot` stay forbidden.
  - The guard hook (`scripts/lib/claude-hooks.ts`) and `tdd:audit` let a skip through only with the
    note.
- **Bounded.** `unstable-skip-ratchet.test.ts` checks every skip has its note, and caps the
  repository at 10 skips.
- **The skip comes out with the fix.** The quick job runs `scripts/unstable-issues.ts`, which reads
  each noted issue's state with gh. It needs `issues: read`, in that job only. A closed issue fails
  the run, and so does one gh cannot read. So the PR that closes the issue must also take the skip
  out. Tests cannot reach the network, which is why this check is a CI step and not part of
  `bun test`.
- **Cost.** A skipped test proves nothing while it is skipped. The cap and the open-issue check keep
  that a short, visible state, not a place to leave a test.
- **Security review.** It found no high or medium. Two lows were fixed:
  - A skip on any receiver (`test.concurrent.skip`, `each(...).skip`) now counts and needs the note.
    It is the same `.skip(` the audit marks, so none escapes the cap or the issue check.
  - The gh read retries once.

  Lows kept as they are:
  - A note inside a string still counts.
  - Any open issue satisfies the check, so a human reviews which issue is cited.
  - `skipIf(<other condition>)` is not counted, as before.
  - Closing a noted issue turns CI red until the skip comes out, and that is the point.
