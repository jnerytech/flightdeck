# A desktop feature's components get their own entry, ui.ts (issue #2451)

## Context
`desktop-cycles-baseline.json` held 157 files in one import cycle around `lib/app-store.ts`. The
app store imports `lib/compose/*`, a composition file imports a feature's `index.ts`, and that entry
re-exported `.tsx` components that import the app store. `scripts/lib/arch/cycle-files.ts` folds a
barrel into all its targets, so importing one slice from an entry reached every screen it
re-exported. Removing every `.tsx` re-export from the feature entries (a throwaway measurement on
2026-11-12) left 85 files in a cycle; the other edges are separate work.

## Decision
A desktop feature has two public entries: `index.ts` (state, wiring, pure rules; it re-exports no
`.tsx`) and `ui.ts` (its components). Composition files and other domains' state import `index.ts`;
screens import `ui.ts`. The `desktop-no-deep-cross-domain` rule accepts both. The moves go one
feature per PR, structure only, starting with the entries the composition files import; a rule that
fails an `index.ts` re-exporting `.tsx` comes with the last move, so it adds no known violation.

## Discarded
- Components read the store from a React context instead of importing `app-store.ts`: it breaks the
  cycle at its other end but touches every component and the tests' render helpers.
- A new composition file with deep imports past the entries: it breaks the one-entry rule and grows
  the known violations, another ratchet.

## Consequences
Each move lowers the cycle count by the files only its screens kept in the cycle (terminal: 157 to
148). Two entries per feature instead of one; `ui.ts` is a re-export list like `index.ts`.
After the last move (2026-11-13) the `desktop-entry-exports-no-component` rule fails an `index.ts`
that re-exports a `.tsx` value; a type-only export passes.
