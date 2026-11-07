# One data scope for the scoped screens, in their toolbar (issue #126)

## Context

Home, Sessions, Costs and the Board each pick their hosts their own way:
- Home adds up every online host.
- The hub keeps `hubFilter.host`.
- Costs keeps a local choice.
- The Board reads its route.

The host switcher at the top is about tabs. Since #644 it names the active tab's host and offers "Tabs of all hosts" (`2026-11-07-all-hosts-row.md`).

## Decision

- **One value in the store,** `dataScope` (`lib/data-scope.ts`, key `flightdeck.dataScope`): `{ kind: "all" }` or `{ kind: "host", hostId }`. It is kept across starts, and a storage that refuses is not fatal.
- **Fallback:** a host that is no longer there means every host. An offline host keeps the scope, and the screen says it is offline and offers **Show all hosts**.
- **The control is a "Data from" menu in each scoped screen's toolbar,** not the host switcher. The switcher would otherwise carry three overlapping ideas: the current host, all hosts' tabs, and whose data to show. Two of them would read "all hosts".
  - The menu shows only with two hosts or more.
  - It says the scope and changes it for every scoped screen at once.
  - A change is announced in a polite live region.
- **A route's own host or project wins for that visit and never rewrites the scope.** A deep link, or a Home card that opens Costs on a project, is an example.
- **Home's cache entry** is the set of hosts in scope, so a switch never shows another scope's cached totals.

## Slices

1. The store value and Home (this one).
2. Sessions: `hubFilter.host` is read once into the scope, then dropped. It held a host's name, so
   the store maps it to that host's id once the saved hosts are loaded (an unknown name means every
   host); a scope already chosen wins. The hub's Host select and Hosts row go, and the hub has the
   Data from menu. A route's host ("See all sessions") is a visit override that any pick in the
   menu ends.
3. Costs.
4. The project level, for every scoped screen (below).

## Slice 4: the project level

- **A third kind,** `{ kind: "project", projectKey }`. A remote key (`github.com/x/y`) already spans
  the hosts, and a folder key (`host:<name>:<path>`) already pins its host, so no screen needs
  "project P on host H". The two kinds already kept parse as before.
- **Menu values:** `project:<key>`, beside `host:<id>` and `all`. The prefix is read before anything
  else, so a folder key, which starts with `host:`, never parses as a host.
- **Not checked against a list:** projects load per host and late (the #860 trap). A kept project is
  never dropped at start; a screen with nothing for it shows its own empty state, with the project
  named in the menu, and the menu offers **All hosts**.
- **The menu** adds a labelled **Projects** group after the hosts, with every project the app knows
  (`knownProjectKeys` and the keys the screens have read), labelled by `useProjectLabels` so a name
  on two hosts carries its host. The live region names the project.
- **The hosts of a project scope** are every host (`scopeHosts`); each screen then keeps the
  project's rows.
- **Route overrides stay visit-only:** Costs opened on a project (a Home card, an alert) and the
  hub's project route win for the visit and never rewrite the scope.
- **Costs:** its own Project select goes; the scope is the one control for whose numbers.
- **Home** (second PR) asks each host's costs for the project and keeps the project's usage rows;
  its cache entry carries the project, and the subtitle names it.
- **Later PRs:** Sessions (the hub merges folder projects by name, so a project scope
  there keeps the merged group's rows by key and says it), then the Board, which has no project key
  and does not follow the host scope yet.
- A host renamed after a folder project was chosen leaves a key no screen has: the screens say so
  and offer every host.

## Discarded alternative

- **The scope in the host switcher:** it reverses #644's decision, which had just merged, and mixes the tab scope with the data scope in one menu.
