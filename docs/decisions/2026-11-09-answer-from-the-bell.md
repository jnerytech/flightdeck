# A request is answered from the bell (issue #1131)

Answering a request meant leaving whatever the person was doing: the bell listed it, a click opened
its session, and the buttons were there. The daily loop is short (see the request, decide), so the
bell's row now holds the decision.

## Decision

- A bell row for a permission request that still waits shows its risk chip and Approve and Deny
  (`ApprovalActions`, the same component as every screen, so a high-risk request is approved only by
  holding the button). With the row focused, A approves and N denies, as in Needs you; a high-risk
  request is never approved by a key. The keys are described to a screen reader on the row.
- Only a plain tool request is answered there. A question, a plan, a workflow gate and a vault
  request have no buttons: they are read in full where they are asked, as the tray already does
  (the tray never answers a gate or a vault request either).
- An answer goes through `store.respondTo`, which asks the hold proof for a high-risk request (#245):
  the row cannot approve one without it. While an answer is on its way both buttons are off.
- A request this run saw waiting that no longer waits, with its host online to say so, is answered:
  it leaves the bell, the bell's count and the taskbar badge (`store.requestAnswered`). A request
  never seen waiting (answered while the app was closed) is not claimed to be answered: it stays, as
  "gone", with Dismiss, since "the host just has not told us yet" cannot be told apart from it at
  connect. The stored entry is not deleted.
- The words on a request row (what it asks, the host) come from the request that waits now, not from
  what was stored with the entry, so the buttons cannot answer something else than what is read.
  A key typed through an input method (`isComposing`) is not a shortcut.
- A row's buttons are a group named by what the row is about, and an answer is announced ("Backend
  tests: approved") by a status region that is in the panel before, once its row has left.
- After an answer the focus goes to the row that took the answered one's place, or the panel's title.
- The `bell-approve` journey answers a request from the bell at 390 px (the web demo sends no
  notification, so the entry is put in the bell by hand).
- A click on the OS notification of the web build and a `flightdeck://request` link opened from
  outside open the session with the focus on that request (`openRequestLink`). On the desktop app
  this arrived with the click decision of the same issue (`2026-11-09-os-click-opens-request.md`). Two strings (`inbox.keys`, `inbox.keysHigh`) in both languages.
