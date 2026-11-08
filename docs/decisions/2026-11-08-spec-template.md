# A card that needs a spec starts with one, as a draft, spec first and test first (issue #78)

## Context

Board stage contracts (#78) can ask for a spec. Slice 3b
(docs/decisions/2026-11-07-card-spec-artifact.md) made `spec` a contract check. It looks for a file
in the card's worktree (`card.specPath`, else `docs/specs/<slug>.md`) and reads only its first
heading.

The issue also asks for artifact templates, "Markdown with front matter, so agents and people
produce the same shape", and for a spec-driven flow where the session works test first through the
project's harness (#75). The design is on #78. This record covers slice S-T1.

## Decision

- **When a spec is written.**
  - It is written only on a card's first start: no earlier run of the card reached a session. A
    first start that failed before its session (a setup script) still counts as first. A re-run, a
    fix run, or a worktree made again after a session never brings back a spec that was moved.
  - It is written only if a column's contract checks `spec` (`contractOf` over every column) or the
    card names its own `specPath`. A project that asks for no spec gets no file.
  - It is written after the setup script, so a script that cleans the tree does not remove it.
  - It is never written over a file that is already there. A workflow run is untouched.
- **What is written.** A built-in template:
  - front matter (`card`, `title` as a JSON string, `draft: true`);
  - the title as a heading;
  - the sections Goal, Acceptance criteria (the card's `- [ ]` items, or an empty one), Out of
    scope and Test plan.
  - Placeholders are filled in one pass, so a criterion that names one stays as it is.
- **How it is written.** Through `createInside` (`apps/daemon/src/create-inside.ts`), moved out of
  the harness apply (#988) so the two share it:
  - every folder on the way is made or found as a real folder;
  - the file is opened with `O_CREAT | O_EXCL` and without following a link;
  - the folder must still resolve to itself before any byte is written.
  - A write that fails leaves a notice with the reason `spec_template_failed` and the path, which
    the app says in its language. The run starts anyway, and the prompt then gets no spec line, so it
    never sends the agent to a file that is not there.
  - On Windows a `\` in a spec path also separates folders (`toSlashes`), so every folder on the
    way gets the link check.
- **Draft.**
  - The `spec` check treats a file whose front matter says `draft: true` as missing. Without this,
    the template would meet the check the moment it was written.
  - The host reads that one boolean from the front matter, within the same 8 KiB, under the same
    rules as the heading.
  - `draft: true` is read as YAML writes it: any case, quoted or not. A front matter that does not
    close within what is read counts as a draft, so the check fails closed.
  - A file with no front matter, or one without `draft: true`, is found as before. The front
    matter's lines are not searched for the heading.
  - `SpecState.draft` is optional and present only when true, and is kept in `cards.spec_draft`.
  - It is a key of its own: the documents panel's front-matter `status` (valid, transitional,
    obsolete, #76) is a document's lifecycle, and one key must not carry two meanings.
- **The first prompt.** It gains one fixed line after the description: start with the spec at
  `<path>` (in backticks), complete it and remove `draft: true` if it is a draft, then for each acceptance
  criterion write a failing test, commit it, then the code. When the worktree has the harness TDD
  skill (`.claude/skills/tdd/SKILL.md`, #75), the line names it. A fix run's prompt is its own and
  gets no such line.

## Alternatives discarded

- **Templates in the repo (`.flightdeck/templates/spec.md`) in this slice.** That is slice S-T3. It
  needs a second safe reader, and it must apply only in a trusted project: an untrusted project's
  CLAUDE.md does not load, and a template the first prompt sends the agent to read would get around
  that.
- **Templates on the host, like task templates.** Two hosts with the same project would drift
  apart, and the agent working in the repo could not see them.
- **Reuse the documents panel's `status` for draft.** It means something else.
- **Write the spec at card creation.** There is no worktree before the first run.

## Consequences

- A project that asks for a spec gets the same shape of spec on every card, and the agent is told to
  complete it before it codes.
- A spec stays unmet until someone removes `draft: true`, so a card cannot pass a column that asks
  for a spec with the bare template.
- The app shows the draft state in a later slice. Until then, the card page shows the spec as not
  there.

## Slice S-T3a: a trusted project's own template

- **Where it comes from.** `.flightdeck/templates/spec.md` in the project, read from the trusted
  checkout: the folder `sessionTrust` names (`templateRootOf`). For a worktree that is its main
  checkout, never the branch, as #196 reads a worktree's configuration. When no checkout is named,
  no template is read: the worktree's own copy is the branch's.
- **When it is read.** Only for a trusted project. For an untrusted one the built-in template is
  written: the first prompt sends the agent to the spec, so an untrusted template would reach the
  agent before the person trusted the project, as its CLAUDE.md would.
- **How it is read.** It goes through `readInside`, which shares the path walk with the harness
  preview (`walkInside` in `create-inside.ts`):
  - a link anywhere on the way is refused;
  - only a plain file is read, of at most 32 KiB;
  - an empty file is ignored.
  - The file must have one name only, and it is read through a handle that follows no link and
    must be the file the walk found, at most one byte past the cap.
  - Any of these falls back to the built-in template. A trust check that fails also falls back, and
    goes to the daemon's log (never the template's text). The card shows no notice yet: that is new
    text in both languages, planned with the validation note template.
- **What it gives.** It gives the body only, with the same `{{title}}` and `{{criteria}}`
  placeholders filled in one pass. The host adds the front matter (`card`, `title`, `draft: true`)
  either way, so the spec check works the same for every template. A template without
  `{{criteria}}` gets none of the card's criteria: the project chose its own shape. A template with a
  front matter of its own keeps it below the host's, which is the one the check reads.

## Slice S-T3c: a notice when a project's template is ignored (issue #1058)

- **What is said.** When the project has a spec template that was not used, the card gets a notice
  with a reason of its own, in both languages and without the template's text:
  `spec_template_untrusted` (the project is not trusted), `spec_template_unsafe` (a link, a second
  name or not a plain file), `spec_template_too_big` (over 32 KiB) and `spec_template_empty`.
  A project with no template says nothing. The run starts with the built-in template either way.
- **Untrusted projects.** The host does not read their checkout. It only looks whether the card's
  worktree carries the template (`lstat` of the name, which follows no link and reads nothing), so a
  template that is not committed to the branch is not noticed.
- **Why the notice is a refusal reason.** The card's notice already carries a reason the app
  translates (`spec_template_failed`); one reason per cause keeps the text out of the host and the
  words in the dictionaries.
- **Still open.** The project's own validation template (`.flightdeck/templates/validation.md`),
  which waits for the validation placeholder (#1054).
