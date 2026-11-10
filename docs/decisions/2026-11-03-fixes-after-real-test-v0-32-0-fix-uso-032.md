# Fixes after the real test of v0.32.0 (fix-uso-032) (issue #1711, moved from DECISIONS.md)

- The main window sets `dragDropEnabled: false` in `tauri.conf.json`. On Windows, Tauri's native
  file drop (on by default) swallows the HTML5 `dragover` and `drop` events in WebView2, so Board
  cards and tabs could not be dragged with the mouse. The app uses no file drop from Tauri
  (`onDragDropEvent` is used nowhere), so nothing is lost. A test pins the setting.
- A Board column under a dragged card gets the `drop-over` outline and tint.
- The tab strip may be empty: closing the last tab leaves the area on a `start` screen with no
  strip, and the empty window is kept in the snapshot. Opening a screen that already has a tab
  focuses that tab (same route, whatever the order of its fields); Ctrl or middle click still
  opens a new one; duplicates in an older snapshot fold into one.
- `session.create` takes no first prompt: the session starts idle and the first message begins
  its first turn. The New session form has a Model select (default, opus, sonnet, haiku).
