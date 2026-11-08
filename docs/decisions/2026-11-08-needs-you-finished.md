# Needs you lists what finished (issue #1134)

From the ranked proposals of #1126 (round 4 of #168), proposal 4: "Done since you last looked".

- **A finish** is a managed session whose status leaves a turn (starting, running, awaiting
  permission) for idle (done) or error (failed), or goes to ended. The rule is `finishOutcome` in
  `lib/finished.ts`, the same turn boundary the notifications use, so the list and the notification
  never disagree. A status frame that repeats, or the first sight of a session, is not a finish.
- **One entry per session**, the latest; the list keeps the last 50. Entries and the time of the last
  look are kept in the app's storage (`flightdeck.finished`) and survive a restart.
- **Since the last look.** Needs you shows the finishes after `finishedLook`. Leaving the screen
  sets it to now, so what was on screen is old next time. While the screen is open a new finish is
  added to the group and stays until you leave.
- **Not listed** when the session was on screen and the app had focus: the person saw it end.
- **Changed files.** The app asks the host `changes.get` for `session:<id>` once after the finish and
  shows the count when it answers; a host that cannot say (no repository, offline) leaves the count
  out. "See the changes" remembers the Changes view for that session and opens it.
- **Notifications are not new.** `turn-finished` and `session-failed` already send one OS
  notification per transition and stay quiet while the app has focus, under the notification
  preferences and #933's once rule; this card reuses them. An end is listed but sends nothing:
  it is usually the person's own End.
- **What is kept.** The list holds host-supplied session names, host ids and times in the app's
  storage (50 entries at most, cut and length-limited when read back), like the notification
  bell does. It has no expiry besides the cap.
- **Not counted** in the sidebar's Needs you number or the taskbar badge: they count requests that
  block a session, and a finish blocks nothing.
