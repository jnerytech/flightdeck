# TDD audit waivers (rc/0330) (issue #1711, moved from DECISIONS.md)

While assembling rc/0330, three `fix` commits landed without an earlier `test(<same scope>)` commit: `61bbf253`
(projetos-pagina), `cb3dc865` (mudancas-ui) and `e28af243` (recusas-recurso). Each repaired a test or a ratchet that the
merged branches broke only in combination, so the guarding tests already existed, under another scope or in the commit
itself. The audit counts a test commit only if it comes earlier in `git log --reverse`, so a later `test(...)` commit
cannot satisfy it, and rc/0330 was already merged elsewhere, so history is not rewritten.

`scripts/tdd-audit-waivers.json` lists the accepted exceptions as `{ hash, scope, reason }`. The rules are strict: a waiver
matches the full 40-character hash and the scope only; one whose commit is inside the audited range but is not a
violation is reported as stale and fails the audit, so the list cannot grow silently; one whose commit is outside the
range (a later release audits from a newer tag) is ignored and shown as an `ignored` note; and the output prints every
waived commit. Nothing else in the audit is relaxed. New entries need the maintainer's agreement.

Added for rc/0360, with the maintainer's agreement: `25bf03fd` (print-theme), the removal of the doubled `:root` that an
rc/0330 merge left on fase-33. Its red `test(print-theme)` commit `3de6e5be` is in `main` (through fix-dark-prints), outside
the range the audit reads, and the css-theme guard pins the fixed state.
