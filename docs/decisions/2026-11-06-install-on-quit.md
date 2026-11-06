# A downloaded update installs when the app quits from the tray (issue #402)

- **Why.** With Update automatically on (#280) the new version waits for a restart; a person who
  quits instead would start on the old one again.
- **How.** The tray's Quit no longer exits at once: the Rust shell emits `quit-requested` and the app
  installs the downloaded update with `restartAfterInstall: false` (Windows' passive installer would
  start the app again otherwise), then calls `quit_now`. A failed install still quits. A second Quit
  while the first installs is ignored.
- **Never hangs.** The shell exits by itself after 10 s. An emit succeeds even with no page
  listening (before the app has started, or after it crashed), so that wait is what such a Quit
  costs; it is kept short rather than adding an acknowledgement round trip.
- **Not covered.** Closing the window with close-to-tray off and a system shutdown still exit
  without installing; the update is offered again at the next start.
- **Reviewed** by the tauri-rust-reviewer: `quit_now` is an app command of the main window only (no
  `remote` capability), and exiting from the fallback thread is safe.
