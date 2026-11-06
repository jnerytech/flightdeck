# Decision records, one file each (issue #304)

- **Why.** Every PR that recorded a decision appended to `docs/DECISIONS.md`, so two PRs in flight
  always conflicted there. GitHub's merge ignores `merge=union` (#294), so they went DIRTY on the
  PR and needed a local merge each time (#299 and #303 on 2026-11-05, after #300, #285 and #294).
- **The rule.** A new entry is a file under `docs/decisions/` named `<yyyy-mm-dd>-<topic>.md`, with
  a first line `# <title> (issue #N)` or `(phase N)`. Different files never conflict.
- **The old file is frozen.** `docs/DECISIONS.md` keeps every entry up to this change, with a
  pointer at its top. A test pins its sha256 (`scripts/lib/decisions.ts`), so an entry appended to
  it fails CI with the way to move it. `merge=union` stays for the old file; it costs nothing.
- **What changed with it:** CLAUDE.md, the new-phase skill, the spec-verifier agent, the SPEC
  template and the READMEs point to `docs/decisions/`.
