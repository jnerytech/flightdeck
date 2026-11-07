# Simple mode: notifications, tray and window title in plain words (issue #88)

Closes the gap recorded under phase 33 in `DECISIONS.md`: the tray, the OS notifications and the
window title did not follow the mode of the host that raised them.

- **Protocol.** `PendingPermission.plain` (a `PlainInfo`) rides on `session.summary`, so the app has
  the plain sentence for a pending request without waiting for the `permission.requested` event
  (#749).
- **Notifications and tray menu.** `needsYou` carries `plain`; for a host whose effective mode is
  simple (`store.uiMode(hostId)`), the notification title is `notify.plainWaiting` and its body the
  plain sentence. The tray menu is built per host (`trayMenu(items, t, simpleHost)`) (#761).
- **Window title and tray tooltip.** `store.syncTitle()` sets the title through the new optional
  platform method `setTitle`. The title follows the host being shown (`uiHostId()`): it says "N tasks
  waiting for your answer" when that host is in simple mode and has waiting requests, else "Flightdeck". The tray tooltip uses the plain wording only when every
  waiting host is simple, so a mixed set keeps the technical text (#775).
- **Tauri.** `setTitle` calls `plugin:window|set_title` for the `main` label only. The call needs
  `core:window:allow-set-title`, which `core:default` does not grant, so it is added to
  `capabilities/default.json` (precedent: `setWindowTheme`). The Tauri reviewer accepted: valid
  identifier, one command, main window only, no text sanitising needed (#782).
- **Left alone.** `core:default` is broader than the app needs; trimming it is a separate change.
