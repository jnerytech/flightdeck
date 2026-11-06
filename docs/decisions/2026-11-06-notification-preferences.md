# Notification preferences (issue #149)

Rebuilt on today's `main` from the stranded branch `notify-prefs` (4 commits, about 2,900 behind
`main`); the work was redone from the branch, not merged.

- **One place decides.** `lib/notify-policy.ts` holds `decide(prefs, source, now)`: who is told, on
  which of the OS, the bell and the sound, for each notification. Every `notifyUser` call carries its
  source (the event, the host, the project, the session); a call without one is the event "other"
  (a security warning, a loop alert), which only the master switch can silence.
- **Muting is silence, not hiding.** A muted source sends nothing and leaves no bell entry, but a
  blocked permission is state: it stays in Needs you and in the sidebar count, which are built from
  the sessions themselves, not from the notifications.
- **The master switch off keeps the bell.** It turns off the system notifications and the sound; the
  bell is the app's own record. An event switched off turns off all three, because the person said
  they do not want to hear of it at all.
- **Team folding** waits ten seconds from the first worker's finished turn, then sends one message
  for two or more, or the worker's own for one. It needs to know which sessions are workers: the app
  reads `teams.list` when a host connects and follows `teams.updated`. A team closed on the host
  stops folding. A worker's permission request is never folded.
- **A session that failed** is a new notification (the issue lists the switch; nothing sent one
  before): a turn that ends with the status `error`.
- **The sound** is made in the app (a tone from Web Audio, or the chosen file as a data URL kept in
  the app's own storage, about 400 KB at most). It is never played by a host. A browser may refuse to
  play before the person has touched the page; that is silent.
- **`platform.notify` now says whether the system showed it** (true/false). The test notification
  uses it for "Delivered" or "Not displayed". The hint names the Windows setting but has no button to
  open it: opening `ms-settings:` would need a capability the shell does not grant.
- **Since the branch was written**, the Sessions page starts every project folded (#111), Settings
  has one more section and takes `onAutoUpdate`, and the notification center's props are `Readonly`;
  the tests and the code follow that.
- **The taskbar badge** (already on `main`) counts the bell's unread entries, so what the
  preferences keep out of the bell is not counted there either.
- **Not built:** the e2e journey update; the existing bell journey is unchanged by this work.
