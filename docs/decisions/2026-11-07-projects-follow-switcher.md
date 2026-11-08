# The project lists follow the host switcher (issue #932)

## Context

With the top bar's switcher on one host, the sidebar's project tree and the Projects page listed
every host's projects. Opening one of another host moved the switcher there (`host-tabs` gives a
project page its owning host). The person read it as "I pick a host, click a project and it goes
to another host".

## Decision

- **The project lists follow the switcher,** not the data scope (#126). The tree and the Projects
  page are places inside a host's tab set, so they show the switcher's host: the active tab's host,
  else the one the window shows. With **Tabs of all hosts**, or no host chosen, they show every host.
- **One rule for both,** `switcherHosts` (`lib/tab-scope.ts`), read through `useSwitcherHosts`, so the
  tree and the page cannot disagree.
- **A route's own host still wins** on the Projects page (a host page's "All projects").
- **The data scope stays with the numbers screens** (Home, Sessions, Costs): whose numbers, not which
  places to go to.

## Next

- Opening a project of another host from **Tabs of all hosts** says the switch ("Switched to beta"),
  and Back returns to the previous host and page.
- The Teams page's own host select follows the switcher, or says it shows another host.
