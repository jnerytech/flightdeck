# The palette, more (issue #147)

- **Selection.** The row the keyboard is on is `--palette-selection` with a 1 px inset ring `--palette-selection-ring`. The ring is
  what carries the 3:1 against the unselected rows (WCAG 1.4.11); the surface only has to be seen (1.1:1) and keep AA text on it,
  because a surface that is 3:1 against the popover would be a block of colour. `theme-contrast` guards both themes.
- **Scope.** The issue seeds the chips from the header scope (#126). That scope is not in this branch, so the palette seeds them from
  the open screen instead: a board or a card gives host and project, any other screen of a host gives the host. When #126 lands,
  `paletteScope` is the one place to change. Chips are local to one opening of the palette.
- **The create row appears whenever the text matches no card**, even when a session or a project matches it (the issue's rule). It
  is always last, never selected first, and Enter with nothing selected still searches the history.
- **`#123`** is turned into the issue's full reference by asking the host (`issues.get`), because the app does not know the
  repository; a pasted GitHub issue link carries it, and the host refuses a link to another repository.
- **Alt, not Ctrl**, for the recents: `Ctrl+1…9` are the tab shortcuts. The recents keep their state order (needs you, running, the
  rest, each in the order they were used) and are frozen when the palette opens.
- **The cap (eight rows) applies to every section**, so the ninth action is behind "1 more". Typing narrows the list as before.

- **Ported onto main (2026-11-06)** from fd-frontend's stranded branch palette-plus: it keeps main's
  `oldest` request line (#187, #245) and simple-mode action, and draws its keys with `Keycap` (#165).
- **The clients have a section of their own** (decided with the coordinator, 2026-11-06): Manage
  clients and the switches to all clients, to each client and to Unassigned leave the actions for a
  Clients section after them, which is never cut at the eight-row cap. With main's simple-mode action
  the actions grew past the cap, which hid the client switches behind "more"; a person switches
  between every client from here, so they always show.
- **GlobalSearch composes components:** a palette section (title, rows, more) and the scope chips are
  `components/palette/palette-section.tsx`, so the screen stays under its layout baseline.
