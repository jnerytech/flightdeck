# Plan quota at a glance (issue #118, moved to the status bar by #491)

Issue #118 asked for a quota view of its own. With the account cards already on the Sessions
screen, fd-coordinator re-scoped it to a glance: one control in the top bar, before the search.

- It shows one window: the one at the highest level, then the most used, across the online
  hosts, whatever its length (5 hours, 7 days or another the plan sends). An offline host's
  reading is left out, since it may be stale.
- Levels: "reached" at 100%, or where the account card's bar is red (at the host's
  `quota.pauseAt`, or refused by the plan: the same `isHot`), so the top bar never says "near"
  while new cards already wait. "Near" is from 80%, a fixed early warning.
- Colour is never the only signal: a warning mark shows from "near", and the accessible name and
  the tooltip carry the level, the window, the percentage, the host and the time to the reset.
- The bar is the shared native `<meter>` (`components/status/meter.tsx`). Inside the button it is
  presentational to assistive technology, so the button's accessible name carries the reading.
- Below 960 px the window's name hides and the meter and percentage stay.
- Clicking it opens the host's page, where its account card and the quota history are.
