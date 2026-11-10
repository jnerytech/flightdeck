# Phase 32 part 2 — Projects (issue #9)

- **The overview is built from what the app already holds.** `buildProjectCards` takes the online
  hosts' projects, the Sessions hub rows (live sessions are the running and needs-you rows with the
  project's key on that host), the board cards the app has seen (in progress), and each host's last
  seven days from `costs.summary`. Opening the screen runs the palette's load, so a card count
  is as fresh as that load; a project whose board was never fetched counts zero cards.
- **Cost is "—", not zero, when the host cannot say.** A host without the `costs` feature is not
  asked, and a host that has not answered yet shows the dash until it does. A host that answers
  with no row for the project shows US$ 0.00.
- **"Needs you" on a card counts sessions, not cards.** The waiting column is a state of the card,
  and its session already counts as a session that needs you, so counting both would show the same
  request twice.
- **The project page links, it does not summarise.** Board, Sessions, Workflows, Costs and
  Settings open the existing screens. Sessions opens the hub filtered to the project (a `project` param on
  the `hub` route and a chip that clears it; the choice lives in the list, so opening a session
  keeps it, and a different project from the route replaces it) and Settings opens the host's project settings, where the project is edited. The page
  is a grid of destinations so the tiles of issue #8 add a section beside it later.
- **Offline hosts are left out of the overview**, like the other cross-host lists: their projects
  are not known until they reconnect.
