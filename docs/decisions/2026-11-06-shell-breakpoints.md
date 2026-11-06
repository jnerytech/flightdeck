# The shell follows three window widths: rail, overlay and drawer (issue #641)

The shell reads the window through one hook, `useBreakpoint()`, which answers `compact` below
640 px, `medium` from 640 to 1023 px and `wide` from 1024 px. It replaces the single 960 px query.

- Wide: the 240 px sidebar pushes the content; the header button folds it to the 56 px rail.
- Medium: the rail stays and the button opens the full sidebar over the content.
- Compact: no rail; the button opens the sidebar as a drawer, `min(320px, 85vw)` wide.

Divergences from the spec of the layout work, kept small on purpose:

- The overlay at medium and the drawer at compact are the same modal sheet (the vendored `Sheet`).
  The spec asks for a plain overlay at medium; a modal one gives it the focus trap, Esc, click
  outside and `aria-modal` for free, and the rail under it is hidden from assistive technology.
- The sheet closes when the person navigates: the shell takes a `navKey` that changes with the route.
- The wide choice (folded or not) is still not remembered; that comes with the rest of the shell.
- The sheet's close button reuses the "Collapse sidebar" text, so no new dictionary entry.
- Focus goes back to the header button on close; Radix has no trigger to return it to, because the
  button sits outside the sheet.
