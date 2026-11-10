# Phase 31 — card dependencies (phase 31)

- **`deps-automations` was dropped.** Automations, teams and the MCP tool only start a card they
  just created, which cannot have blockers, so the gate cannot meet a blocked card there. The only
  doors for a blocked card are the app's `card.start`, `card.startArena` and the board's own fix
  runs. `deps-gate` has a test that lists the files calling `startCard`; a new caller fails it until
  someone checks it against the gate.
- **One gate, in `startCard` and `startArena`.** `card_blocked` (code `invalid_state`) carries the
  blockers' titles; a PR fix run (`options.fix`) skips it. `card.move` is not gated, as the spec says:
  it is the manual override.
- **`waitingOn` is derived, `waiting` is stored.** What a card waits for is read from the blockers'
  columns on every `getCard`. The `waiting` column only remembers that the card was waiting, so the
  *end* of a wait fires once (the mark or the auto-start) and a card linked to blockers that were
  already done is never marked. A link edit by the person updates the flag and fires nothing: taking
  the last blocker away by hand does not start a card.
- **The mark and the notification.** `unblockedAt` is set by the daemon; the app notifies when a
  card it already knew gains it, so a card marked before the app connected is not announced again.
- **A discarded blocker leaves the set and the dependent hears it** in the same step (a notice with
  the blocker's title, then the end-of-wait logic). The notices the daemon writes here ("Blocker ...
  was discarded", "Auto-start failed: ...", "Could not refresh <base> from origin: ...") are English
  text, shown as they are, like the older notices; the refusals have both languages.
- **The base a waiting card starts from** (`freshBase`, in `worktree.ts`) is `origin/<base>` after a
  `git fetch origin <base>` when the local base is an ancestor of it, else the local base. It never
  moves the local base branch (it may be checked out), and a card with no blockers does not fetch.
- **Areas were done in the order protocol, model, state, gate, autostart, base, ui**, because the
  `Card` type needs its fields first. `deps-smoke`, `deps-e2e` and `deps-shots` are scopes of their
  own for the smoke, the journey and the prints. The smoke's red run was shown by switching the gate
  off for one run; the `dependencias` journey was written after the screen was green and passed in
  both languages on its first run.
- **The chain is drawn with an arrow, not an indent.** The layout ratchet counts the margin and
  padding utilities an indent needs, and a new screen may hold none, so a blocker's own blockers are
  marked with a decorative arrow in a list of the same width.
- **The demo gained a chain of three cards** (schema, API, screen) in the main project: the board
  print now shows the badges. This is the one place where a print is not identical to before the
  phase, and it is the point of the print.
- **Cross-project dependencies stay out** (see the spec's open choices): the table already holds
  ids, so a later flag needs no migration.
- **Known reds not caused here:** `board-clique` (the "Criar card is off" test) fails on `main` at
  `54f4bee6` too, and the `i18n` language-switch test is intermittent under load.
- **The New card dialog takes no blockers.** It never had a Start button (a new card lands in the Backlog),
  so the spec's "not offered while blockers are chosen" has nothing to hide; the blockers are set from the
  card's detail, where the picker already keeps cycles out. `card.create` takes `blockedBy` for any other
  client (the MCP tool and the demo seed use the wire form).
- **No separate version bump.** A phase branch does not bump the version (the maintainer does, with the
  `test(versao)` cycle, at release); the spec does not list it among the acceptance criteria.
