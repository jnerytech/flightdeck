# BDD: the quota panel and its guard (issue #1218)

## Context

fd-coordinator asked for `.feature` files for what shipped after round 4. The status bar's quota
now opens both windows of a host and the guard "new cards wait from N%" (#1218).

## Decision

- `quota-panel.feature`: from the queue of what needs the person, pressing the quota in the
  status bar opens the panel with the 5 hours and 7 days windows of host alfa; choosing 70% sets the
  guard on the host; after the app reloads, the panel still reads 70% (the host kept it).
  About 8 to 12 s.
- Own state: the demo host's guard is shared between the English and the Portuguese run, so the
  scenario reads the guard before it changes it and puts it back at the end.
- It goes red when the choice is cut: the guard does not read 70% by itself.

## Not covered

The effect of the guard (a new card waiting once the quota is over it), the near-limit notice on a
card, and the read-only text on a host that cannot change the guard: the component tests hold them
(`quota-popover`, `quota-notices`); the demo has no way to push a host's quota over a guard
from the steps.
