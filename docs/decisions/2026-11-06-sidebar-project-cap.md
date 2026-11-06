# Sidebar project tree: five projects, pins, a filter and a default fold (issue #689)

- **Why.** After #215 each project capped its checkouts at 8, but the tree listed every project: with 20-30 projects it pushed
  Board, Automation and the rest of the sidebar far down.
- **The cap.** The tree draws at most `PROJECT_CAP` = 5 projects: the pinned first (the most recently active of them if there
  are more than five), then the most recently active (`lastActivityAt`: the newest session inside the project's folder on its
  host; none is 0, ties by name). The project of the picked checkout is always drawn, after the five.
- **All projects (N).** With more than 5 projects a link below the tree opens the Projects page. With five or fewer there is
  no link: the Projects item above the tree is the way.
- **The filter.** With more than 5 projects a field narrows by name (case ignored), to every match, pinned first; Esc clears it.
- **Pins.** A pin button on the project's row, kept per host and project on this computer (`flightdeck.treePinned`).
- **The fold.** With more than `FOLD_ABOVE` = 3 projects all but the active one (the project of the picked checkout) start
  folded. The person's choice wins: folded projects stay in `flightdeck.treeFolded`, projects unfolded against the default in
  `flightdeck.treeOpened`. A folded project with a needs-you (first) or a running session shows that state's dot on its name.
- **Not built:** the rail layout (#641) shows only the Projects icon and has no flyout, so item 4 of the issue (the flyout with the
  same short list) needs the flyout first and stays open.
