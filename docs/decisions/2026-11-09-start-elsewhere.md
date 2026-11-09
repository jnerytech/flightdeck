# Start a card on another host when its host is full, paused or held (issue #1422)

#1422 assumed a card move between hosts. None exists: `card.move` changes a column, and teleport (#100)
moves a session, not a card. This slice adds the smallest honest version, in the app only, with no new
command and no new host feature.

## Decision

- **Where.** The Start N confirm (#1354). When some of the startable cards would wait (the host is at
  `maxParallelRuns`, paused by #1404, or held for memory or budget, #1343), the confirm lists
  "Start on <host>" buttons. It never moves anything without the person pressing one.
- **Which hosts.** Online hosts other than this one, not paused, with a project of the same project key
  (the same repository) and at least as many free places as cards that would wait. Free places are the
  host's `maxParallelRuns` minus its cards running now. A host whose limit is unknown is not offered.
- **Which cards.** Only the cards that would wait go. A card whose template names a workflow or a
  persona is not offered: the new card would start with the target host's defaults, a different run.
  Nothing else of the card travels: not its dependencies, pinned documents, estimate or spec path.
- **How.** Per card, in the board's order: `card.create` on the target (title, description, so the
  criteria go with it), then `card.start`. Only after the target accepts the start, the source card gets
  a line appended to its description, "Started on <host> as <card id>", and moves to Done. It is **not
  deleted**: the card keeps its history, and moving it back to the Backlog undoes the hand-off. A Done
  contract that refuses (a project's own) leaves the source where it is, with the refusal named.
- **Failures.** A refused `card.create` leaves everything as it was. A refused `card.start` deletes the
  card just created on the target (it never started, so it holds nothing) and leaves the source alone.
- **Not done.** Moving the cards in one go to several hosts, a "Move all" for the whole board, carrying
  the workflow and the persona, and any daemon change. The free-place check reads the app's own state
  (`maxParallelRuns` from `project.list`, running cards in the store); the target's memory or budget
  holds are not known to the app, so the target may still queue a card.
