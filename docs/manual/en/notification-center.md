# Notification center

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/notification-center.md)

The bell at the right of the top bar keeps every notification the app sends: a request that
needs you, a session that ended, a budget or quota alert, a PR watch result, a card that was
unblocked. A badge on the bell counts the unread ones.

- Click the bell to open the panel: unread first, then newest first, in two groups (Today and
  Earlier). Opening the panel marks nothing as read.
- An unread row has a dot, a bold title and the word "unread" for a screen reader; a read row has
  none of them. The badge counts the dots. Each row names the session, card or team and the host,
  and says what it asks in words ("Asks: which DB to use?"), not the tool's name. A session's
  repeated requests become one row with a count ("3 times"). A row whose card or request is gone
  says so and has **Dismiss**.
- A request that still waits is answered from its row: its risk chip, then **Approve** and **Deny**
  (with the row focused, **A** approves and **N** denies, as in Needs you). A high-risk request is
  approved by holding the button, never by a key. A question, a plan, a workflow gate and a request
  for a secret have no buttons: click the row to open it. An answered request leaves the bell, also
  one answered somewhere else (while its host is offline the row stays, since nothing says it was
  answered). After an answer the focus goes to the row that took its place, or to the panel's title.
- Hover a row (or focus it) for a small **Mark as read** control: it marks that row and opens
  nothing.
- Click an entry to mark just it read and open its screen (a request opens on its card; a quota alert
  opens the host). A budget alert opens Costs already filtered by its host and project, or by
  its client; a team alert opens Teams with that team first and marked. A card's entry (a PR watch
  result, an unblocked card) opens the PR in your browser when the card is gone.
- On Windows the unread count also shows on the app's taskbar button, as a red badge with the number
  (`9+` past nine). It is the bell's count, row for row, so it falls as you read and goes when the
  list is clear; a source you muted sends no entry and so adds nothing. It comes back with the
  count the next time the app starts.
- **Mark all as read** keeps the list; **Clear** empties it. The list is kept on this computer
  (the newest 500) and survives a restart. Esc closes the panel.
- A read row has **Mark as unread** (hover or focus it) to come back to it later.
- The OS notifications are sent as before unless you tune them (below). The center only keeps a
  copy, so one that is never sent (the window had focus) is not in it either.
- Click the system notification of a request and the app comes forward on that request: its
  session opens with the focus on it, whether the window was minimized, behind others or in the
  tray. A notification that is not about a request opens nothing.

## Tuning notifications

**Settings, Notifications** (kept on this computer, honoured after a restart):

- **Show notifications** is the master switch for the system notifications and the sound; the
  bell keeps its entries. Below it, one switch per event: **Needs you** (a permission or a
  question), **Turn finished**, **Session failed** (a turn that ends in an error), **PR watch**
  and **Budget and quota**. An event that is off sends nothing, not even a bell entry.
- **Mute** a host, a project, or one session (the menu of a row on the Sessions list: **Mute
  notifications**, or **Snooze notifications for 1 hour**). A muted source sends no system
  notification, no sound and no bell entry. It still shows in **Needs you** and in the sidebar's
  count: a blocked permission is state, not an interruption. The muted sessions are listed there
  with a button to unmute them; a snooze ends by itself.
- **Fold a team's finished workers into one message** (on by default): workers of a team that
  finish within ten seconds send one notification, "Team Alpha: 3 workers finished". A worker's
  permission request still notifies at once, since someone has to answer it; the coordinator
  notifies like any session.
- **Sound**: off, the system default (a short tone made by the app) or a file you choose (MP3,
  WAV, OGG, M4A, AAC or FLAC, up to about 400 KB), with a volume. It plays from the app, never from
  a host.
- **Send test notification** shows one and says **Delivered** or **Not displayed**; when the system
  did not show it, it names the Windows setting (Settings, System, Notifications, Flightdeck).
- Simple mode keeps its single switch and none of these controls.
