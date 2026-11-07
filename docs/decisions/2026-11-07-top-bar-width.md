# The top bar follows the shell's three widths (issue #641)

The layout decision (`2026-11-06-responsive-layout.md`) says what the top bar keeps at each width.
This is how it is built, and where it differs.

- Wide (1024 px and up): the switcher shows the host's dot and name, then back and forward, the
  path, the search field, the theme and bell buttons and the version.
- Medium (640 to 1023 px): the switcher shows the dot and the host's initial, the path shows its
  last step, the search is its icon. The name stays the button's accessible name and its tooltip.
- Compact (below 640 px): as medium, and back and forward leave the bar for the top of the
  sidebar's drawer (`AppShell`'s `drawerTop`). The bar has no path there already.

Choices:

- The initial is a `span` hidden from assistive technology, because the button's `aria-label` names
  the host. A host with no name yet keeps the server icon, as before.
- `HistoryButtons` is one component used in both places, so the two spots cannot drift apart.
- The drawer closes on a navigation (the shell's `navKey`), so back or forward closes it. This is
  the same rule as picking a sidebar item, and it leaves the page visible.
- The version and the search keys hide below 1024 px, as they did below 960 px before the narrow
  rules moved to the shell's width.

Not done here: the status bar's compact "..." popover, and the 360x480 window minimum.
