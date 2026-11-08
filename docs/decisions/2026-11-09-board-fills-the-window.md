# The board fills the window: columns share its width and the ROI card folds to one row (issue #1030)

The CI prints of #114 showed two things that kept the board from using the window. At 1280 px the
fourth column was cut at the right edge, because every column was a fixed 260 px (five of them need
1348 px, a 1280 px window gives the board about 992). And the Return on cost card, folded to its
headline, still took about 100 px (a title row, then a card-sized headline), so the columns began far
down.

- **Columns share the width until the person picks one.** `BoardWidth` now knows whether a width was
  chosen (kept from an earlier run, or set with the handle). Until then the width of each column is
  `fitColumnWidth`: the board's measured width, less the gaps and 8 px for the last column's resize
  handle (which sits past its edge, and would make the row scroll by 3 px), divided by five and floored.
  At 1280 px that is 187 px; at 1700 px, 328 px, up to 520. A width the person chose is
  used as it is, as before. The handle's range now starts at 180 px, not 220, so the width the board
  picks and the value the handle announces never disagree. When the board is too narrow even for 180
  px (a window under about 960 px, or the Files panel open beside it), the columns keep the usual
  260 px and the board scrolls inside itself, as it did (180 px columns made a card's badges run past
  the card in pt-BR at 640 px). A column's name gives way with an ellipsis before the count and the + do.
- **The folded ROI card is one row.** Folded, the title, the first line of the card and Details sit on
  one row, with the first line cut by an ellipsis when it is long; the card keeps a small padding.
  Opened, it is the card it was.
- **Both are measured in the browser.** The `board-fit` journey, at 1280 x 800 in both languages,
  checks that the five columns fit (the row does not scroll sideways, no lane passes the window, the
  last one reaches the row's right edge), that no column head runs past its lane, and that the ROI card
  is at most 64 px high with the columns at most 32 px below it. Unit tests pin the width rule and the
  card's markup, which a test without a layout engine cannot measure.
