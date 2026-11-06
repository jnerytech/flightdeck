# The status bar at the bottom, and the quota glance moves into it (issue #491)

The user asked for a slim bar at the bottom like Orca's. It re-opens what #118 left out for
720x480, so the bar keeps the floors of #422 and #437.

- **One bar, 24 px.** `components/shell/status-bar.tsx`, in `AppShell`'s `status` slot (a third
  grid row). The height is the CSS variable `--status-bar-height`, so what floats over the window
  (fd-ux-designer's update card, #490) can sit above it. The line above the bar is an inset shadow,
  not a border, so all 24 px are for the items: axe's target-size rule asks 24 px of a target.
- **The quota glance moves down; it does not show twice.** Agreed with fd-ux-designer: it leaves the
  top bar (`TopBarQuota` and its slot are gone; the top bar gets its room back at 720 px) and keeps
  everything of #118 (see `2026-11-06-quota-glance.md`): `quotaGlance` and its levels (`isHot`, from
  80% "near"), the warning mark, the level, host and time in the name and tooltip, the shared native
  `<meter>`, and the click that opens the host. It adds the time left beside the percent and a
  refresh button (`AppStore.refreshQuota`: each online host is asked again; one that does not answer
  keeps its reading).
- **The right side is what no other place says at a glance.** Keep-awake (the hosts that offer it,
  as one state: holding, on or off; it opens the host that holds, else the first that has it on),
  open terminals (tabs of both areas; it brings the first forward), hosts online of all (it opens the
  first host that is not online), and the app update (ready, on offer or a failed check; it opens
  Settings, and is not drawn when there is nothing to say).
- **Accessible.** Every item is a button named by words, never colour alone, with a tooltip; the two
  counts are `<output>` (role status), so a change is announced. What no host reports (no quota, no
  keep-awake, no update) is not drawn. The refresh turns only when the person has not asked for less
  motion, and is disabled and `aria-busy` while it asks.
- **It steps aside in a short window.** Under 600 px of window height the bar is hidden (`shell-status`,
  a `max-height` media query): at 720x480 the conversation measures about 160 px (the floor is 150),
  so 24 px more would break the floors of #422 and #437. Its items stay on their pages (the host page
  has keep-awake, terminals and the account card; Settings has the update). Agreed with
  fd-ux-designer, who measures it again with the 36 px tab row of #488.
- **Not done:** a ports count (Orca has one; Flightdeck has no list of ports today).
