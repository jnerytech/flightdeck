# Phase 32 part 2 — palette v2 and shortcuts (issue #9)

- **One registry for the shortcuts** (`lib/shortcuts.ts`). The `?` sheet, the palette's hints and
  the matcher read the same list, so a key is never described in one place and bound in another.
  Shortcuts a screen handles itself (`j`/`k`/`Enter`, `A`/`N`) are listed too, with no action.
- **Go-to chords are `g` then a letter**, within 1.5 s, and never while typing in a field or with
  Ctrl, Alt or ⌘ held (so they cannot clash with the browser or the OS, which `Ctrl`/`Alt`
  letters would). `Shift` alone keeps a chord pending. Not verified on the real Windows build
  (WebView2); only plain letters are used, which it does not reserve.
- **Recents are the ids of the last palette entries used**, kept in the app's storage (12, five
  shown, only with nothing typed). An id that no longer exists is dropped when shown. An action
  picked from the Tab list is not recorded as a recent.
- **Approve/deny the oldest request** reuse the tray's rule: a high-risk request is opened to be
  held instead of approved from a command. The commands show only while a request waits.
- **Not done in this slice:** per-row action menus beyond the Tab actions that already existed
  (copy id, open in split, end), and "switch host" and "open a Settings section" as commands.
