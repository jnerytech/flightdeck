# Domain modules and single responsibility (issue #1589)

The user made organization and modularization by single responsibility and domain a priority
(2026-11-09). The rules are in the root `CLAUDE.md` ("Structure"); this file records why.

## Where the code stood (2026-11-09)

- `apps/daemon/src/main.ts` 2,865 lines, `board/board.ts` 2,143 (split in progress, #1523),
  `workflows/engine.ts` 1,320, `sessions/session-manager.ts` 1,115; 45 loose files at the top of
  `apps/daemon/src`.
- `apps/desktop/src/lib/app-store.ts` 5,600 lines, `styles.css` 3,710, `ui/BoardView.tsx` 1,528;
  `components/`, `lib/` and `ui/` are global folders by kind, and `ui/` collides in name with the
  vendored `components/ui/`.
- `i18n/en.ts` and `pt-BR.ts` about 6,200 lines each: every UI PR edits the same two files.

## Decision

Folders by domain, one public entry per domain, no deep imports or cycles across domains, modules
cut by reason to change, deep modules, pure domain rules with I/O in adapters, the desktop by feature
with one store slice per domain, dictionaries per domain, and moves done as one structural PR at a
time. The exact rules are in `CLAUDE.md`.

## Sources

| Source | Principle | What it means here |
|---|---|---|
| Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules" (1972) | Information hiding | A module hides one design decision that may change; cut by what changes, not by the steps of a flow. |
| Constantine and Yourdon, *Structured Design* (1979) | High cohesion, low coupling | What changes together lives together; as few dependencies between modules as possible. |
| Robert C. Martin, *Clean Architecture* (2017) | SRP, CCP, CRP, ADP, SDP, SAP; screaming architecture | One actor per module; package by what changes together; no cycles; depend toward stability and abstraction; the tree names the domain. |
| Eric Evans, *Domain-Driven Design* (2003) | Bounded contexts, ubiquitous language | Each domain has its model and its words (`docs/GLOSSARY.md`), with an explicit border. |
| John Ousterhout, *A Philosophy of Software Design* (2018) | Deep modules; against classitis | A small interface over real work; too many shallow modules raise complexity. The counterweight to SRP taken too far. |
| Alistair Cockburn, "Hexagonal Architecture" (2005) | Ports and adapters | Domain rules free of I/O; SQLite, WebSocket, processes and Tauri at the edge. |
| Melvin Conway (1968); Skelton and Pais, *Team Topologies* (2019) | Conway's law | Several sessions work in parallel: clear borders mean fewer conflicts between their PRs. |
| Martin Fowler, *Refactoring* (2018); Michael Feathers, *Working Effectively with Legacy Code* (2004) | Strangler fig, seams | Move a piece at a time behind a stable entry, tests green at every step. |
| Kent Beck | "Make the change easy, then make the easy change" | A structural PR never carries a behavior change. |

## Not decided here

The checks that enforce the rules (no deep import across domains, no cycles, a file-size baseline),
the domain map of each app, and the order of the splits (`main.ts`, `app-store.ts`, the dictionaries)
are follow-up issues.
