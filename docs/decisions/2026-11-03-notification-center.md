# Notification center (issue #1711, moved from DECISIONS.md)

- Every `platform.notify` call in the store now goes through one funnel, `notifyUser`, which keeps
  an `InboxEntry` (id, time, title, body, an optional request `link` or `route`) before sending the
  OS notification. The OS side is unchanged.
- The list is app-side only, in `platform.storage` under `flightdeck.inbox`, newest first and
  capped at 500. It is loaded at `init`.
- A notification the app suppresses (the window has focus) is not kept either: the center mirrors
  what was sent.
- A click opens the entry's screen: a request link goes through `openRequestLink`; quota alerts
  carry the host route. Other entries (budgets, PR watch, teams) have no screen yet and only
  mark as read.
- Not done: per-entry mark as read without opening, snooze, filters by kind, a daemon-side
  history. The Linear and GitHub inbox patterns (unread marker, mark all, grouping by time) come
  from general knowledge, not from fetched pages.
