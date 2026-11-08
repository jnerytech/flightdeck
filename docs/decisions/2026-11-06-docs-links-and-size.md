# The docs link checker and the Markdown size ratchet (issue #169, ported)

- **Links.** `scripts/lib/md-links.ts` checks every tracked Markdown file:
  - a relative link must name a file that exists;
  - an anchor must name a heading of that file, slugged as GitHub does (lowercase, accents kept,
    punctuation dropped, duplicates numbered `-1`, `-2`);
  - code spans, fenced blocks, and web or mail links are skipped;
  - a test fixture's Markdown (`test/fixtures/`) is skipped too, because it stands for another
    repository's file.
- **Doc paths in the code.** The code check reads `docs/...md` paths in `*.ts`, `*.tsx`, `*.rs`,
  `*.yml` and `*.json`, but not in the tests. Tests name such paths as fixtures, and a test that
  reads a real doc fails by itself when the doc moves. A template such as `docs/SPEC-fase-N.md`
  is skipped.
- **Size.** `scripts/lib/md-size.ts` checks the size against `md-size-baseline.json`, using the
  layout ratchet's `overBaseline`. The limits:
  - 150 lines for a nested `CLAUDE.md`, `.claude/rules` and `.claude/agents`;
  - 300 for a `SKILL.md`;
  - 400 for every other file.

  Some files get fixed limits of their own, outside the baseline, because they grow by design and
  a down-only baseline would block them. The root `CLAUDE.md` gets 260 lines (219 today, with
  lines waiting for the owner's word). Each manual gets 4500 (it was 4000, raised on 2026-11-08 when
  the pt-BR manual reached 4003 lines; about 3150 when the port was done, and every phase
  adds to both; they grew 35 lines in the hour this port was open). The frozen
  `docs/DECISIONS.md` has no limit, because `decisions.ts` pins its content. The baseline holds
  only `docs/SPEC-fase-40.md` at 702, and only goes down.
- **Ported on 2026-11-06.** The branch `harness-docs-checks` was written on 2026-11-05 for an
  rc/0365 that was never cut. At that time `DECISIONS.md` and the manuals were capped with
  headroom, waiting for a split. The split happened another way (#304, `docs/decisions/`), so the
  caps are now today's counts.
