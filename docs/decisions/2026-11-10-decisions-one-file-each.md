# The old DECISIONS.md entries are files of their own (issue #1711)

- **Why.** `docs/DECISIONS.md` was 4,385 lines, frozen since #304 with a sha pin and no size limit.
  Agents read it whole to find one phase's divergences, and the newer records already lived one
  per file under `docs/decisions/`.
- **What.** Each `# ` section (a phase's divergences) and each `## ` entry appended flat after them
  is a record of its own: 113 files, named `<date>-<topic>.md` with the date of the commit that
  added the heading (`git log -S`), and a first line as `docs/decisions/README.md` asks. A title
  with neither a phase nor an issue names this move: `(issue #1711, moved from DECISIONS.md)`.
  The text is unchanged; an entry appended flat has its headings one level up.
- **The index.** `docs/DECISIONS.md` keeps one link per record, in the old order, and stays frozen
  by the same sha pin (`scripts/lib/decisions.ts`), so a new entry still cannot land there. Its
  size exemption goes: it fits the 400 of any doc.
- **Readers.** `conta-poc.test.ts` reads the phase 34 record; the spec verifier and the new-phase
  skill find an old phase's divergences by its `(phase N)` title, like a new one's.
