# A session's state is a shape as well as a colour (issue #146)

- **Why.** Five 8 px dots that differ only in colour fail people who do not see the colours apart
  (WCAG 1.4.1), and a pulsing dot for "running" read as an alert.
- **Chosen.** `StatusDot` draws a glyph in a 12 px slot: a ring spinner while running (it turns only
  when motion is allowed, and stops while off screen), a question mark when it needs you, an alert on
  error, a dot when idle and a faded ring when ended. The colour stays the status token and keeps 3:1
  on every surface in both themes. The label names it for screen readers and shows in a tooltip, not
  a native title.
- **A host's connection is not a session's state:** it keeps the plain 8 px dot (`dot`), in the
  sidebar and in the top bar's host switcher (#282).
- **Ported onto main (2026-11-06)** from fd-frontend's stranded branch state-glyphs.
