# The manuals are one file per chapter (issue #1711)

- **Why.** `docs/manual/en.md` and `pt-BR.md` had reached 4,209 and 4,230 lines, under a fixed
  limit of 4,500 that every phase pushed up (`2026-11-06-docs-links-and-size.md`). Agents read a
  doc whole, and every phase appended to the same two files.
- **What.** Each `## ` chapter is a file under `docs/manual/<lang>/`, named after the English title
  in both languages (`en/board.md` and `pt-BR/board.md`), its headings one level up, with a link
  back to the index and to its twin. The text moved unchanged; only links were pointed at the
  chapter files, and two stale lines were fixed (the version the manual "applies to", and the
  development commands' 100% coverage, now the 80% gate of #1002).
- **The index.** `en.md` and `pt-BR.md` keep the intro and every chapter heading, so an old
  `#<chapter>` link still lands, and list each chapter's sections as links. An old link to a
  section (`en.md#from-source`) lands on the index, one click from the section: the anchors of a
  4,000-line page were not worth keeping as 115 more headings.
- **Size.** The manuals' own 4,500 limit goes: an index and each chapter get the 400 of any doc.
  `board.md` is the largest chapter (371 in English, 384 in pt-BR); a phase that pushes it past 400
  splits it in a docs commit of its own, before the feature.
