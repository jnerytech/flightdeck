# A field's action reason is a line of its row (issue #1325)

#38 hung a disabled button's reason under it, out of the flow, so it adds no height to its row. Beside
a field (the `field-with-action` rows of a card's Details and its adjustment) that broke twice:

- #1270: hung from the button, the reason ran past the card's right edge. It was then hung from the
  row's right and grew left.
- #1325: the row is followed at once by more text (the spec file's status line, Check again). A reason
  that wraps (pt-BR, at every width) or a narrow window drew it over that text.

Decision: inside `field-with-action` the reason is part of the row. The row wraps, the button's box is
`display: contents`, and the reason takes a whole line under the field and every button (Use theirs
too). The row grows by that line while the button is off and shrinks when it turns on, the same as a
`FieldRow`'s help line (#732). Covered text is worse than that shift.

Below 40rem (#1326) the field also takes a line of its own, and the buttons go under it, at the end.
At 390 the field used to get less width than its Save button.

Elsewhere (a toolbar, a dialog footer) the reason still hangs out of the flow, as #38 set. The narrow
guard's `reason-over` rule now reports a reason drawn over other text anywhere, and `card-gate` is a
narrow print.
