# The host page leads with sessions and projects (issue #110)

- **No second implementation.** The sessions are the Sessions list's own rows (`hubRows`) in its own `SessionCard`, in the list's
  own order (`hubRowOrder`, now a function of its own); the projects are the Projects list's own `ProjectCardTile` over the same
  `useProjectCards` data. The host page only filters them to the host and caps them at six; archived sessions stay out.
- **"See all" carries the host.** Sessions: the hub's host filter is set to the host's name (and saved, like any filter of that
  list), through a `host` on the `hub` route that the list applies once. Projects: the `all-projects` route takes a host id and
  shows a chip, with a clear button, instead of a new screen.
- **Tabs: Overview, Usage, Settings.** Overview has the sessions, the projects, the Claude account and the host information; Usage
  the quota and the usage table; Settings the allowed folders, bypass, simple mode, doctor, GitHub, daemon update, hooks,
  telemetry, terminal, maintenance and the host actions. The offline banner, the incompatibility notice and the API-key warning
  stay above the tabs: they apply whichever tab is open. The usage table was not made collapsible: it has its own tab now.
- **Tests that used the old single page** now open the Settings tab first where they touch what moved there.
