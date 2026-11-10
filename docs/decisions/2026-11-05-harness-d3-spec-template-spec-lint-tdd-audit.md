# Harness D3: the SPEC template, spec:lint and tdd:audit --spec (issue #169)

- **The template keeps the shape the specs settled on** (Goal, Proof of concept first, Design,
  Tests and criteria since phase 28) and adds what was missing or ad hoc: Non-goals; Protocol,
  migration and rollback; Acceptance scenarios with the `.feature` each Feature runs as (#131
  keeps the BDD work itself); Risks; Acceptance criteria and Real checks as their own headings;
  and a Test file column in the area table. It lives in `docs/templates/SPEC.md`; the specs stay
  in `docs/` (review S4-7).
- **The lint reads the sections as an ordered subsequence.** Recent specs put extra headings
  between them (phase 36's answers and addendum, phase 33's decisions), so extra headings pass and
  "None." is a valid body (review finding on `spec-lint`). A row's area is kebab-case; its test
  file is in `apps/*/test`, `packages/*/test` or `scripts/test`, named after the area as
  docs/TDD.md asks, or is a smoke or a `.feature`; a `-ui` area is tested in `apps/desktop/test`.
- **From phase 40 on.** The 38 older specs, many in Portuguese and none with the Test file
  column, are not held to it; a spec can opt in with `<!-- spec-lint -->`. The suite lints every
  held spec, so CI enforces it without a new step; `bun run spec:lint <spec>` is for the author.
- **The table and the commits check each other.** `tdd:audit -- --spec <spec>` fails on an area
  with no `test(<area>)` commit in the range. `new-phase` and `spec-verifier` call it; an older
  table (no Test file column) yields no areas, so their audits run as before.
