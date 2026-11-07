# The switcher's All hosts entry lists every host's tabs, grouped by host (issue #644)

For people who work across hosts at once, one row of every host's tabs beats switching host to look.

- The host switcher has a checkbox entry, "Tabs of all hosts", offered with two hosts or more. The
  choice (`tab-scope.ts`, key `flightdeck.tabScope`, "host" or "all") is kept like the tab order's.
  It does not change which host is current: the switcher still names the active tab's host.
- Checked, the first area's row is the shared tabs, then each host's first-area tabs in a group.
  A group starts with a header: the host's dot and name, drawn for the eyes only (`aria-hidden`),
  since each tab already carries its host in its accessible name. Each tab has its own host's color.
- `HostTabs.groups()` gives each host and its first area. `HostTabs.activate` now also takes a tab of
  another host: it makes that host the current one and shows the tab, so a pick in the row keeps the
  switcher and the screen in step.
- Only the first area's row is grouped: a split's second area keeps its own tabs. A window that is
  split shows the other areas' tabs only in their own bars.
- Closing a tab of another host from the row goes through its own set. A terminal tab waits for the
  detach-or-end answer as before; `finishCloseTerminal` looks for its area in every host's first
  area, not only the current host's.
- The narrow window's list of all tabs lists every row tab, so it shows all hosts' tabs the same way,
  each with its host's dot and name.
- #644 is complete with this: per-host sets, colors, titles, the compact button and this row.
