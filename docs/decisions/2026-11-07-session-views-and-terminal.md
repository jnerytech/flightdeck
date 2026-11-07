# The session page: a tab bar and a Terminal view (issue #107)

- **Tab bar.** The view buttons of `SessionTabs` are one `tablist` (roving tabindex, arrows, Home
  and End, wrapping), the active tab marked by a fill, a bar under it and a heavier weight. The
  conversation stays mounted under the other views, as before.
- **Keys.** Ctrl+1 to 9 already switch the app's tabs, so the views took **Alt+1 to Alt+7**: the
  Nth view the page has (a view the host does not offer has no number, so the Terminal is Alt+4 on a
  host with Files and no Time, Trace or Messages). The keys work from anywhere in the page, the
  message box included, and not from the palette. **Ctrl+`** toggles Terminal and Conversation.
  Inside the terminal the page takes these keys in the capture phase of the terminal's panel and
  stops them there, so xterm never sees them and the shell gets neither an ESC and a digit nor a
  NUL; `terminalKeyAction` and xterm are unchanged, so a standalone terminal tab keeps every key.
- **Remembered view.** `SessionViews` (in the store) keeps the last view per session tab
  (`<host>/<session>`) for the run of the app; it is not written to disk. A remembered view the host
  does not offer shows the Conversation and is kept.
- **Palette and sheet.** `SessionViews` also holds the page on screen (`register`), which is how the
  palette lists "Show <view>" first among its commands and runs them, and the `?` sheet has a
  "Session views" group.
- **Terminal view, daemon.** `terminal.openSession {session, cols, rows}` is a new command, not a
  change to `terminal.open`: the protocol baseline keeps every line of the release baseline. The
  folder is `manager.get(session).cwd`, checked like any open (allowedRoots by real path, folder
  locks, terminal enabled); the schema is strict, so no cwd, argv or env comes from the app. The
  host announces `terminal.session`; without it the app offers no Terminal view.
- **Terminal view, app.** `SessionTerminal` reuses `TerminalPage` unchanged. It is built when the
  view is first shown and kept hidden after, so a view switch never ends the shell; the shell id is
  kept per tab, so a page that returns re-attaches to it (a host that cannot list its shells gets a
  new one). Closing the terminal from the view returns to the Conversation. Closing the app tab
  ends the shell the tab opened (`terminal.close`, kill). A session started from a terminal ("Claude
  aqui") shows that PTY (`useLaunchTerminal`, moved out of `ExternalView`) and a tab close leaves it.
- **Left alone.** A session of another runtime (OpenCode) gets the same view: the shell has nothing
  to do with the runtime. A shell survives navigating inside the tab and is not ended when the app
  restarts (the host keeps it until it is closed or the host stops).
