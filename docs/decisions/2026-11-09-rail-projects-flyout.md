# The rail's Projects icon opens the project tree beside it (issue #689)

#693 gave the sidebar a tree that scales to many projects (a cap, pins, a filter, folding), but the
collapsed rail still sent its Projects icon straight to the Projects page, so a person with the rail
folded could not reach a branch without expanding the bar.

## Decision

- With the rail collapsed and at least one project to list, the Projects icon toggles a panel
  beside the rail (`RailFlyout`, a Radix popover anchored to the icon) with the same `ProjectTree`
  the expanded bar shows. The panel is named "Projects", and the icon says `aria-haspopup="dialog"`
  with its `aria-expanded` state.
- The panel always ends with **All projects (N)** (`ProjectTree` takes `allLink`), since the icon no
  longer goes to that page by itself. Elsewhere the link still shows only past the cap.
- Picking a branch (or clearing it) and following the link close the panel. Esc closes it and the
  focus returns to the icon; a press on the icon while it is open closes it instead of reopening it.
- With nothing to list, and in the expanded bar, the item is as it was.
- No new text: the panel reuses "Projects" and "All projects (N)", so both languages already have it.
