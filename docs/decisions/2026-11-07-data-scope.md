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
2. Sessions: `hubFilter.host` is read once into the scope, then dropped.
3. Costs.
4. The project level, for every scoped screen.

## Discarded alternative

- **The scope in the host switcher:** it reverses #644's decision, which had just merged, and mixes the tab scope with the data scope in one menu.
