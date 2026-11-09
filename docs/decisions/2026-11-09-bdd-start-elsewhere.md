# BDD: start a card on another host (issue #1451, for #1422)

## Context

The Start N confirm offers "Start on <host>" when the cards would wait here (#1422, PR #1441). The
unit and component tests hold the rules; no journey ran the hand-off across two demo hosts. The issue
spoke of a source card "leaving the queue"; the feature moves it to Done with a note instead, and
never deletes it (docs/decisions/2026-11-09-start-elsewhere.md).

## Decision

`start-elsewhere.feature`, three scenarios (en and pt-BR), no seed change:

- **Hand-over.** Alfa is paused, so a started card waits. The scenario adds a project of its own with
  a remote to alfa and a clone of the same remote to beta: the project key is the normalized
  `remote.origin.url`, so the two hosts hold one repository. Selecting the card (Ctrl-click) and
  pressing Start 1 offers "Start on beta"; pressing it ends with "1 card started on beta.", the source
  card in Done with "Started on beta as <id>" in its description, and a copy of the card running on
  beta's board.
- **Not offered.** The project exists on alfa only. The check is that the confirm lists no
  "Start on beta" and no hint line. Absence proves nothing until beta has answered, so a small tap in
  the page (a `WebSocket.prototype.send` patch, as in the while-away journey) counts the project lists
  beta is asked and has answered; the step waits until the one asked after the confirm opened is
  answered and the page drew twice.
- **Beta refuses.** The tap answers beta's `card.start` with a refusal in the page; `card.create` and
  `card.delete` still reach the real host. The board says the card did not start, the source stays in
  Backlog without the note, and beta's board has no copy (the app deleted it).

Each scenario ends by resuming alfa; the first Given also resumes it if an earlier run left it paused.

Mutations, each red for the right reason (one run, three bugs): the project key match replaced by the
host's first project (scenario 2: "host beta is offered"); the move to Done skipped (scenario 1: the
card never reaches Done); the source moved to Done also when the start is refused (scenario 3: the card
is not in Backlog).

## Not covered

More than one card, or a full beta (`board-start-elsewhere-ui` and `start-elsewhere` hold the free
places and the order). Cards with a workflow, a persona or blockers (not offered, unit-tested). A
target that refuses `card.create`. A copy that could not be deleted ("a copy is left").
