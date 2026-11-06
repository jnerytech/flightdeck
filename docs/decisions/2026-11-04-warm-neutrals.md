# Warm-neutral surfaces, lines and text (issue #119)

- **Why.** The neutrals leaned cool (hue 270), which read cold next to the status colors and the
  brand; a warm grey reads calmer for long sessions.
- **Chosen.** Every neutral of both themes (backgrounds, surfaces, popover, text, muted text, lines,
  field edge, sidebar) sits at hue 75 with very little chroma (at most 0.02); translucent black lines
  and pure white or near-white surfaces stay as they are. `surface-1` is a touch lighter in the dark
  theme so the steps between surfaces stay visible.
- **Contrast holds:** text keeps AA on every light surface, and muted text keeps 6:1 there, because it
  is often drawn at 80%. `scripts/test/theme-contrast.test.ts` pins the hue, the chroma and the ratios.
- **Ported onto main (2026-11-06)** from the stranded branch palette-warm; the light field edge that
  #176 added since was warmed too.
