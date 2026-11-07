# A host's tabs show their section, and are named with the host (issue #644)

The row belongs to one host, and the top bar's switcher names it, so the tabs do not repeat it.

- `tabTitle` (the strip, the list of all tabs, the Ctrl+Tab switcher) gives a host's Overview the title
  "Overview" and its History "History". Every other title already ended in what the screen shows.
- A screen reader needs the host, since a tab's visible title no longer carries it: each of the
  host's tabs has the accessible name "{title}, host {host}" (with the badge's words in the title, as
  for a pinned tab). The shared tabs keep their names; they belong to no host.
- Picking a host (a change of the row's host) puts "{host}: {n} tabs" in the strip's polite status
  region, which also carries the move announcements. A new tab in the same host says nothing.
- The announcement is made once per change of host, by the host's name: a window that opens on a
  host says nothing, and a host not loaded yet waits for its name. The first area's pane stays mounted
  across a switch of host (`Areas` keys it as "first"), so its tab row keeps the host it last spoke of.
- The other names built from a tab's title (the move announcement, the tab's actions and move
  buttons, the Ctrl+Tab switcher) stay single-host: they only ever show the tabs of one host. The All
  hosts row (still to come) shows several, and folds the host into them then.
- The tablist keeps one name, "Tabs": its row holds the shared tabs and the host's, so it is not one
  host's list. The host is in each tab's name.
- Still to come in #644: the compact tab button and the All hosts row.
