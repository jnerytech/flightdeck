# Decision records

Each decision or divergence from a spec is a file of its own here (#304). `docs/DECISIONS.md` holds
the entries up to 2026-11-05 and is frozen: GitHub ignores `merge=union`, so every PR that appended
to the one file conflicted with every other one in flight.

- **Name:** `<yyyy-mm-dd>-<topic>.md`, the date the decision was made and a short topic in lowercase
  words joined by hyphens (`2026-11-05-ci-prints-matrix.md`). Two PRs never pick the same file.
- **First line:** `# <title> (issue #N)`, or `(phase N)` for a phase's divergences.
- **Body:** as the entries in `docs/DECISIONS.md`: the why, then what was chosen, in short bullets.

`scripts/test/decisions-files.test.ts` checks the names and first lines, and that
`docs/DECISIONS.md` stays as frozen.
