# The pack personas get English ids (issue #3413)

The pack's personas that had Portuguese ids are renamed: `arquiteto` is `architect`, `coordenador`
is `coordinator`, `revisor` is `reviewer` and `seguranca` is `security`. The ids are the keys the
code, the card columns, the teams and the persona shortcuts (#3426) name them by, and the code is
in English (CLAUDE.md, Conventions).

## Decision

- The pack files carry the new ids. The display names stay as they are, per language.
- An old id still works. `Personas.find` looks the exact id up first, in the project, then the
  host; only on a miss does it try the renamed id. A persona the person made under an old id, or a
  project file with one, is therefore never hidden by the alias. `save` does not apply the alias.
- A store migration renames the ids it holds: the host personas table (and the JSON id inside),
  the persona of managed and external sessions, the card runs, the cards' start persona and the
  projects' persona per column. A host row moves only when the new id is free, so a persona the
  person made under the new id is never merged into. A project persona's snapshot (it has a hash)
  keeps its id.
- Sessions numbering (`session_names`) and trust rows (`persona_trust`) are left alone: they are
  keys of their own, not references.

## Discarded

- Keeping the old ids as the stored ones and adding the new as aliases: every new reader would
  carry the Portuguese names for good.
- Migrating without an alias: a script, a workflow file or a team config in a repository that the
  migration cannot reach would stop working.

## Consequences

- The old ids stay resolvable for as long as the alias map exists; removing it is a later decision.
- The app's own uses of the ids (global personas, client defaults, backup) and the docs follow in
  the next PRs of #3413.
