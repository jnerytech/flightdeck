# Decision records

Each decision or divergence from a spec is a file of its own here (#304): GitHub ignores
`merge=union`, so every PR that appended to one shared file conflicted with every other one in
flight. The entries written in `docs/DECISIONS.md` until 2026-11-05 are files here too (#1711);
that file is now their frozen index.

- **Name:** `<yyyy-mm-dd>-<topic>.md`, the date the decision was made and a short topic in lowercase
  words joined by hyphens (`2026-11-05-ci-prints-matrix.md`). Two PRs never pick the same file.
- **First line:** `# <title> (issue #N)`, or `(phase N)` for a phase's divergences. A short note
  may follow the number: `(issue #109, part b)`.
- **Body:** the why, then what was chosen, in short bullets.

`scripts/test/guards/decisions-files.test.ts` checks the names and first lines, and that the
index `docs/DECISIONS.md` stays as frozen.
