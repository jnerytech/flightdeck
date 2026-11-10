# Phase 38: board sync with external boards (GitHub Projects first) (phase 38)

- **GitHub goes through the host's `gh api graphql`.** The daemon holds no token. The provider's `scopes()` reads
  `gh auth status`; a token that lists no scopes (fine-grained) counts as read and write, and the calls themselves refuse
  with `board_sync_scope_missing` when it is not. `setStatus` checks the write scope before it sends anything.
- **Every pull reads every page.** Whether GraphQL or REST honours `If-None-Match` is not confirmed (see the research), so
  the GitHub provider is not conditional: it reads up to 20 pages of 100 items and the engine compares the result with what
  each card last saw. The `notModified` answer and the cursor stay in the interface for a provider that has them.
- **A status change at the provider is a manual move on this board.** The spec said a locked card is not moved. On the
  board, "locked" only stops the automatic moves (a PR state, a session event); a person's move always goes through, and
  a status changed on the external board is a person's move. So sync moves locked cards, with `moveCard`, which may lock
  them again in the Backlog or Done as a hand move does. A card that is queued, in a workflow run or in progress with a
  session is not moved: the log gets a `move_skipped` entry with the status it did not apply.
- **Only the title is pulled after creation.** A card gets the item's title, body and link when it is made. Later, a
  changed title at the provider replaces the card's title (the old one goes to the log as `title_changed`); the body is not
  pulled again, because the card's description is where people add their own notes.
- **A trigger marks a local move.** `cards.local_moved_at` is set by a database trigger when `board_column` changes, so
  no board code had to change; a sync that settles the card (pull applied, conflict lost, push sent) clears it. With push
  off the mark stays on a card that moved here, which is what makes a later change at the provider a conflict to be settled
  by time and logged.
- **No `boardsync.updated` event in this phase.** The cards a sync changes already reach the app through `board.watch`
  (`card.updated`); the app asks `boardsync.status` when the Sync control opens and after Sync now.
- **Push gives up after five tries.** A move that fails to send is logged (`push_failed`, with the reason) and tried at the
  next sync; after five in a row a single `push_gave_up` entry is written and the card is left alone.
- **Not verified here:** the stderr text of a missing scope and of a rate limit, and the `Status` field name on boards that
  renamed it, come from memory and the fakes; the proof of concept in the spec settles them.
