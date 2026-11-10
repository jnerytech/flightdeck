# DECISIONS.md merges with the union driver (issue #290)

- **Why.** Every parallel PR appends a section at the end of this file, so two PRs added at the same
  place and conflicted on it (#285 and others, 2026-11-05) although nothing was in dispute.
  `.gitattributes` now says `docs/DECISIONS.md merge=union`: a merge keeps the lines of both sides.
  `scripts/test/decisions-union.test.ts` proves it on a temporary repository (two branches that each
  append a section merge cleanly with both kept; without the rule they conflict) and checks that the
  rule is in the file.
- **Only this file.** The recent edits of `docs/DECISIONS.md` all land in its last 130 lines. Those
  of `docs/GLOSSARY.md` and of both manuals land all over the file (a table row, a feature's
  section), where a union merge would keep two versions of one edited line side by side with no
  warning. They keep the normal merge and its conflict.
- **What union does not do.** Two PRs that edit the *same existing line* of DECISIONS.md both keep
  their version of it, one after the other: read the merged section once before the hand-off. Add a
  section, do not rewrite an old one.
