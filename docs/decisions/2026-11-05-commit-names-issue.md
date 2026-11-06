# A feat or fix names its issue (issue #253)

- **Why.** `release:close` (#252) closes the issues a tag ships. Nine of v0.36.4's issues shipped in
  commits that named no issue, and had to be closed by hand.
- **The rule.** The commit gate refuses a `feat`/`fix` with no issue. The issue can be:
  - `(#N)` inside the subject's parentheses (`(#12)`, `(#12, #13)`, `(review of rc/0364, #237)`);
  - a message line or `--trailer`: `Refs: #N`, `Closes #N`, `Fixes #N` or `Resolves #N`.

  A bare `#12` in the subject text, or a "see #12" in the body, does not count.
- **Not waived, not wider.** `TDD-Waiver` is for the TDD order and does not lift this rule. Other
  types (`test`, `docs`, `chore(versao)`, `refactor`) need no issue, and neither do merges,
  reverts, `fixup!` and `squash!`.
- **Naming is not closing.** A `Refs:` line names the issue for the gate. Since #367,
  `release:close` closes only what a merged PR closes (its closing references, or a
  Closes/Fixes/Resolves keyword), and lists a referenced issue as "left open". The stranded branch
  also made `release:close` close on `Refs:`. The port leaves that out.
- **The audit does not check it yet.** It would fail the commits made before the gate. Once a
  release has gone out with the gate, the audit can add the same rule.
- **Ported on 2026-11-06.** The branch was written on 2026-11-05 for an rc/0365 that was never cut.
