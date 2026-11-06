# Board columns tinted by status (issue #115)

From the Orca reference of #114.

- **Ideas, not brand.** Each column gets a thin top line and an 8% tint of its own tone, a status icon, the count as a pill, a +
  and a quiet dashed empty box. The tones are our own tokens (`--column-backlog|progress|waiting|review|done`) in both themes:
  neutral, amber, orange, green, muted. The reference has four columns; ours has five, so Needs you gets its own orange.
- **Guards.** A test reads the tokens of both themes: the line must read at 3:1 on the background, and the foreground and the
  muted foreground stay AA (4.5:1) on the 8% tint. The column styles live in `styles.css` (`.board-column`), not as utilities in
  the screen, so the layout ratchet is not raised.
- **The + puts a card in its column.** A card is born in the Backlog; for another column the app moves it right after the create
  (`card.move`), because `card.create` takes no column. The empty box is still a button named "Add card".
- **The + puts a card in its column, in one command.** `card.create` takes an optional `column` (additive: an older daemon ignores it and
  the card lands in the Backlog, as before). A create followed by a move could leave the card in the Backlog when the move fails or
  races another window, so the board inserts the card straight into the column, at its end. The empty box is still a button named
  "Add card".

- **Ported onto main (2026-11-06)** from fd-frontend's stranded branch board-tints, with `card.create`
  taking the column. The branch's bottom status bar (#118) is left out: it would add a row under the
  content, which the 720x480 window cannot spare, and its quota glance may fit the top bar (#282).
