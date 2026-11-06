# Text the screen cuts is revealed by a real tooltip (issue #239)

- **Rule.** Where the layout cuts a name (an ellipsis, a narrow rail), the full text comes from
  `IconTip` (400 ms on hover, at once on keyboard focus), never from a native `title`, which
  keyboard users do not get. Text a person needs to act (the hold hint, #238) is not tooltip text:
  it is written on screen.
- **Places changed.** Breadcrumb steps (the earlier ones are buttons: hover and focus; the current
  one is plain text, so it answers to the pointer only, and the page heading carries the same name),
  tile layout options (focus on the radio opens the label's tooltip), the day chart's columns, the
  tabs, the folder picker (steps, folders, files), the narrow rail's host buttons and the sidebar's
  pinned rows.
- **Day chart.** The columns were not focusable, so the title was the only way to read a day. The
  chart is now one tab stop with roving focus (arrows, Home, End); the focused day shows its total
  in the tooltip. Its `aria-label` is unchanged, so screen readers read what they read before.
- **Not changed.** The legacy `title` assertions of `crumb-largura`, `lado-a-lado-ui` and
  `abas-largura` now assert the absence of the title (the mechanism changed on purpose). Hub row
  titles are drawn in full by the cards and need nothing.
- **Based on `design-keycap`,** which adds `IconTip`; it merges after that branch.
