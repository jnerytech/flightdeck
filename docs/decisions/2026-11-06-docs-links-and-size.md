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
  - 150 lines for `CLAUDE.md` files, `.claude/rules` and `.claude/agents`;
  - 300 for a `SKILL.md`;
  - 400 for every other file.

  The frozen `docs/DECISIONS.md` has no limit, because `decisions.ts` pins its content. The
  baseline holds today's counts and only goes down: `CLAUDE.md` 219 (over its 150 since the
  delegation section of #341), `docs/SPEC-fase-40.md` 702, `docs/manual/en.md` 3129 and
  `docs/manual/pt-BR.md` 3111.
- **Ported on 2026-11-06.** The branch `harness-docs-checks` was written on 2026-11-05 for an
  rc/0365 that was never cut. At that time `DECISIONS.md` and the manuals were capped with
  headroom, waiting for a split. The split happened another way (#304, `docs/decisions/`), so the
  caps are now today's counts.
