# The pack personas get English ids (issue #3413)

The pack's personas that had Portuguese ids are renamed: `arquiteto` is `architect`, `coordenador`
is `coordinator`, `revisor` is `reviewer` and `seguranca` is `security`. The ids are the keys the
code, the card columns, the teams and the persona shortcuts (#3426) name them by, and the code is
in English (CLAUDE.md, Conventions).

## Decision

- The pack files carry the new ids. The display names stay as they are, per language.
- An old id still works. `Personas.find` looks the exact id up first, in the project, then the
  host. On a miss, an old id is looked up under its new id in the host's personas and the pack's
  only, so a cloned repository's file with the new name is never what an old script reaches; and a
  new id also finds a project file that kept the old one, so a project's own `revisor.md` keeps
  answering after the stored ids moved. A persona the person made under an old id is therefore
  never hidden. `save` does not apply the alias; `reset` refuses an old id that is the person's own.
- A store migration renames the ids it holds: the host personas table (and the JSON id inside),
  the persona of managed and external sessions, the card runs, the cards' start persona, the
  projects' persona per column, the personas of a team's members and the watch settings' persona.
  A pair whose new id the person already made is left as it was, references and session
  snapshots included. A project persona's snapshot (it has a hash) keeps its id, and so does the
  badge of the same session. The migration cannot read project files: a reference that names a
  project's own persona with an old id moves to the new id, and the project's file still answers
  for it through the alias above (an untrusted file answers with `persona_untrusted`, as it did
  for the old id before). The badge of an external session has no snapshot to tell it apart.
  The migration's rename list is a frozen copy, not the domain's `RENAMED`.
- Left as they are: the sessions numbering (`session_names`) and trust rows (`persona_trust`),
  which are keys of their own, and the `persona-<id>` subagent names of a session: a new session
  offers `persona-reviewer`, and a published `persona-revisor.md` stays in the project until it is
  published again or removed.

## Discarded

- Keeping the old ids as the stored ones and adding the new as aliases: every new reader would
  carry the Portuguese names for good.
- Migrating without an alias: a script, a workflow file or a team config in a repository that the
  migration cannot reach would stop working.

## Consequences

- The old ids stay resolvable for as long as the alias map exists; removing it is a later decision.
- The app's own uses of the ids (global personas, client defaults, backup) and the docs follow in
  the next PRs of #3413.
