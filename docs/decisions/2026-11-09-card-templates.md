# Card templates: a project's cards.json, offered by New card (issue #1201)

## Context

A person who files the same kind of card (a bug, a chore) types the same checklist, picks the same
workflow and persona and pins the same document each time. Proposal 6 of #1190 asked for card
templates kept by the project, like the validation template it already reads from
`.flightdeck/templates/`.

## Decision

- **One file, not a folder.** `.flightdeck/templates/cards.json` is a list of templates (`id`,
  `name`, and optionally `description`, `criteria`, `workflow`, `persona`, `pins`, `spec`). One file
  is read through the same trusted, link-refusing path as the validation template (`templateFor`,
  32 KiB). A folder would need a safe directory listing, which the host does not have.
- **Judged entry by entry.** A template with any mistake (bad id, empty name, a spec or pin the
  card would refuse, more than 10 pins, a duplicate id) is left out and counted, never half used.
  Past 12 templates the rest are counted. A file that is not a list is `invalid`.
- **Trusted projects only.** An untrusted project's file is not read; New card says why. A
  `templateId` that the project does not offer or trust refuses the card (`card_template_unknown`).
- **The host fills the card.** `card.create` takes a `templateId`; the app does not send the
  template's workflow, persona, pins or spec, so a client cannot set them without a template. The
  text is the person's when typed, else the template's.
- **Two new card fields.** A card had no workflow or persona before it started (both were chosen in
  the run form). `startWorkflow` and `startPersona` hold a template's choice; the run form shows
  them already picked when the project still has the workflow and the host the persona. They are
  stored text, not paths: the run form resolves them against the lists it has.
- **`createCard` judges what it stores.** The spec path and the pins go through the same checks as
  `card.update` (a low finding of the security review).

## Not covered

Editing the templates in the app; a template for the New session screen; the card's own page
showing which template it came from.
