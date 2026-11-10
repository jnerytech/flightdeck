# Persona editor in place (issue #134)

- **In place, not a side sheet.** Edit expands the persona's own card into its form where the person is; the first field takes the
  focus and the form scrolls into view (`block: "nearest"`). A new persona still opens at the top, where the + is. Cancel and Save put
  the scroll back and focus the Edit button; a saved pack persona changes scope (it becomes the host's copy), so its card is a new
  one and the button is looked for again by the persona's id after the list reloads.
- **Model and tools as choices.** The host announces no list of models, so the select offers the aliases (opus, sonnet, haiku) and the
  ids the pack uses, with "Other…" for free text (a persona whose model is not in the list opens on it). Tools are a multi-select of
  the tools Claude Code names plus `mcp__flightdeck`, keeping any tool a persona already had that is not in the list.

- **The capacity follows the memory (#216 follow-up).** With 8 Claude sessions (about 3.4 GB)
  and the bun tests, two tsc runs still pushed the Pi to 1.5 GB free and a memory pressure of
  14%. The lane now opens one place per 2.5 GB of `MemAvailable`, between 1 and 2, read from
  `/proc/meminfo` on every try (`lanePlaces`); off Linux it keeps 2, and
  `FLIGHTDECK_LANE_PLACES` overrides the count. A run already in a place the lane no longer opens
  finishes normally; only new runs see the smaller lane.
