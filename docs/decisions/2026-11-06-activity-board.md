# The Activity board, step 1 (issue #151)

- **What it is.** A screen (route `activity`, shortcut `g a`, palette "Go to Activity", sidebar item
  after Costs in Observability) that groups every live session of every host into Needs you,
  Working, Done and Idle. It reads the hub's rows (`hubRows`) and the app's `unread`; nothing new is
  asked of a host. Simple mode never sees it (it has its own shell).
- **The columns.** Needs you and Working follow the row's state. **Done** is a finished turn nobody
  opened, in the last two hours: `state.unread` (set when a managed session goes from running to
  idle while not on screen, cleared when it is shown) within `DONE_WINDOW_MS`. **Idle** is every
  other idle session; it is hidden by default and the choice is kept (`flightdeck.activityIdle`).
  Ended and archived sessions and the history are on no column. Newest change first inside a column.
  Only managed sessions can be Done: a terminal session has no `unread` mark.
  Needs you and Done are tinted with the status tokens (never a new colour). Not in step 1: the cost
  of the turn (the hub's cost is per session, not per turn) and the two-line "last answer".
- **Approve and Deny on the card** answer the request through `respondTo`. A high-risk request is
  approved with the hold button; a question (`AskUserQuestion`), a workflow gate or a vault request
  has no inline buttons, only the session to open.
- **Moving cards.** The arrangement (which card in which column, in what order) is a signature; when
  it changes the new arrangement is applied inside `document.startViewTransition` when the browser
  has it, and plainly otherwise or with reduced motion (`useBoardTransition`). Each card has a
  `view-transition-name` from its key.
- **Filters** are search (title, host, project, persona, last request), host, project and persona;
  they combine, and the line reads "n of m shown" over the columns on show.
- **Rebuilt on main.** The first version sat on a stranded branch ~2,850 commits behind; this one
  is the same model and screen redone on today's main, with the e2e journey `activity`.
- **Step 2, the pop-out window, is not built:** it is a separate issue (a Tauri window, Rust
  reviewed with `tauri-rust-reviewer`).
- **Test anchors:** `activity-column`, `activity-card` and `activity-count` are the `data-slot`
  names the board owns.
