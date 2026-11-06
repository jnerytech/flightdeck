# The taskbar badge (issue #233)

- **The webview draws, the shell only hands over.** The picture (a red disc with the number in white, `9+` past nine) is made in
  `lib/badge-icon.ts` as 32 x 32 RGBA and passed to the `set_unread_badge` command, which accepts nothing but an empty picture (clear)
  or exactly 32 x 32 x 4 bytes and sets the main window's overlay icon on Windows. This keeps the digits testable with the rest of the
  app and means the webview is given no window-overlay permission of its own: the capability file is unchanged, and a test pins that.
- **The count is the bell's**, from `unreadRows`, computed whenever the list changes and when the app starts, and told to the shell only
  when it changes. Muted and snoozed sources send no entry, so they add nothing (#149). The master switch of #149 keeps the bell's
  entries, so the badge, which is the bell's count, keeps counting with it; if the owner wants the badge to follow the OS-notification
  switch instead, `syncBadge` is the one place to change.
- **Other systems.** `setOverlayIcon` exists on Windows only; the command does nothing elsewhere, and a browser has no `setBadge`.
- **Not verified here:** the Rust was written without a toolchain on this machine (no `cargo`); CI builds it and `badge_tests` runs there.
  Reviewed by the Tauri reviewer agent, whose notes are in the hand-off.
- **Ported onto main (2026-11-06).** Reviewed again against the pinned tauri 2.12.5: `set_overlay_icon`
  (Windows only) and `Image::new_owned` exist with no extra cargo feature; the size check is enough
  (tao checks again); no capability, config or lock file changes. `set_unread_badge` stays synchronous
  like the other window commands (blocking-audit list).
