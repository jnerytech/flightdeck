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
- A request answered anywhere leaves the bell and its count, once its host is online to say it no
  longer waits; with the host offline the row stays. The stored entry is not deleted, so a host that
  reconnects with the request still waiting brings its row back.
- After an answer the focus goes to the row that took the answered one's place, or the panel's title.
- A click on the OS notification already opens the session with the focus on that request
  (`openRequestLink`); a test pins it. Two strings (`inbox.keys`, `inbox.keysHigh`) in both languages.
