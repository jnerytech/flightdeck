# The wide window's sidebar fold is remembered (issue #641)

The shell-breakpoints decision left it open: "the wide choice (folded or not) is still not
remembered". It is now.

- `SidebarFoldController` (`lib/sidebar-fold.ts`) keeps `flightdeck.sidebarFolded` in the platform
  storage, as `TabScopeController` does for the tab row's scope. Only `"true"` means folded.
- `AppShell` takes an optional `folded` and `onFold`: the app gives the controller's value and
  saves each click. Without them (tests, other shells) the shell keeps the fold in its own state.
- Only the wide window folds. At medium the rail is always there and the button opens the overlay,
  and at compact it opens the drawer. Neither writes the choice, so a narrow window never changes
  what the wide one remembers, and widening the window brings the remembered fold back.
