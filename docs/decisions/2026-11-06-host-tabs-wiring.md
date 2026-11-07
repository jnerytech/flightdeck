# The window's tabs are one set per host plus the shared screens (issue #644)

The store keeps a `HostTabs` (`lib/host-tabs.ts`, its state layer is in
`2026-11-06-host-tabs-state.md`) in place of one `Workspace`. This is the wiring.

- `store.router` is the `HostTabs` router; `store.hostTabs.open`, `show`, `openPreview`,
  `openNextInNewTab`, `activate`, `close`, `next`, `previous` and `goto` replace the same calls on
  `store.tabs`, so a screen lands in its own host's set.
- `store.workspace` is the current host's window (its tabs and split), an empty one while there is no
  host. `store.tabs` is the shared tabs while a shared tab is active or there is no host, else the
  host's focused area.
- The row is the shared tabs, then the host's focused area. `TabBar` takes the shared `Tabs` for the
  first area; what acts on a tab itself (close, pin, move, drag) goes to the set the tab is in, and
  a click goes through `hostTabs.activate`. A split stays inside a host.
- With a shared tab active the content area shows that tab's screen and the host's tabs stay in
  the row, none selected. With no host the shared tabs are the window's one area.
- The switcher shows `store.activeHostId()` (the active tab's host, or the last one used on a shared
  tab); picking a host calls `store.pickHost`, which swaps the row. A new tab (the **+** button and
  `Ctrl+T`) opens the active host's Overview, or Home with no host.
- The window is kept as the v2 snapshot under the same key; a v1 snapshot is migrated on start.

Behavior that changed on purpose, and the tests that moved with it:

- A sidebar click on a shared screen gives it its own pinned tab beside Home, found again by the
  next click; it is never a preview. Preview tabs exist for a host's own screens.
- Back and forward walk the history of the tab in use. Opening a host's screen from a shared tab
  opens it in the host's tab, so there is nothing to go back to there; the shared tab stays open.
- The terminals item of the status bar counts the current host's terminal tabs.

Not in this change: the tab titles still carry the host's name where they did, the host colors, the
"All hosts" row and the compact tab button.
