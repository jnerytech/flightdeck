# Tabs per host: the state layer (issue #644)

## Context

#644 makes the tab row follow the host switcher: each host keeps its own tabs, the shared screens
stay at the left of every row, and the switcher always shows the active tab's host. The shell spec
(`2026-11-06-responsive-layout.md`, section 5) describes the behavior. This decision covers the
state underneath it, which fd-frontend wires into the store and the screens.

## Decision

- **Compose, don't rewrite.** `apps/desktop/src/lib/host-tabs.ts` adds `HostTabs`:
  - one `Workspace` per host, today's class, so each host keeps its tabs, their histories and its
    own split;
  - one `Tabs` for the shared screens, every tab pinned;
  - a `router` facade that routes each navigation. A screen of the current host's set keeps
    today's rules: it goes to the tab that already shows it, or else the active tab navigates.
    Another host's screen switches to that host and is shown in its set. A shared screen is shown
    in the shared set, or replaces the active shared tab's screen when a shared tab is active.
- **Which set a screen belongs to** is a record over every route name, so a new screen cannot go
  unclassified.
  - Owned by a host, keyed by the route's host id: `session`, `new-session`, `external`,
    `history`, `host`, `projects`, `project`, `board`, `card`, `workflows`, `agent`,
    `automations`, `actions`, `auto-approvals`, `terminal`, and `reader` by its `target.hostId`.
  - Everything else is shared.
  - The `host` of a cross-host screen (`hub`, `all-projects`, `costs`, `teams`) is a filter,
    sometimes the host's name, so those stay shared.
- **A host's Overview** is `{ name: "host", host }`. It is what a new host's set opens on, and what
  closing a host's last tab shows. A set made by opening one of the host's screens starts on that
  screen instead.
- **The switcher's host** is the active tab's. While a shared tab is active it stays on the last
  host used. Removing a host drops its set and moves the switcher to another host, or to none.
  With no host and no shared tab, the window shows the start screen.
- **Ctrl+Tab and Ctrl+1..9** go over the row: the shared tabs, then the current host's focused
  area.
- **Persistence:** `{ v: 2, shared, hosts: { [hostId]: WorkspaceSnapshot }, host, onShared }`,
  under the same key as today (`flightdeck.workspace`).
  - Today's v1 snapshot is migrated:
    - each tab goes to its host's set, or to the shared set, in order (pinned ones first, as a
      strip has them);
    - the focused area's active tab stays active, and its host becomes current;
    - on a shared tab, the first host seen becomes current;
    - a host whose tab was not the active one starts on its first tab;
    - a v1 split is not kept: each host starts with one area.
  - Restoring v2 drops a tab whose route names another host. Unusable input gives a fresh window.
  - An older build reading a v2 snapshot does not know it and opens a fresh window.

## Discarded alternatives

- **A host on every `Tab`, filtered from one list:** fewer objects, but every existing operation
  (step, goto, move, pin bounds, split, reopen) would have to learn the filter. That is a larger
  and riskier change than composing the classes that are already tested.
- **Rebuilding a host's tabs from a snapshot on each switch:** simple, but each switch would lose
  the tabs' back and forward histories.

## Consequences

- This change is not wired. The store keeps using `Workspace` until fd-frontend wires `HostTabs`,
  so nothing changes on screen yet. The wiring maps:
  - `store.router` to `hostTabs.router`;
  - `store.tabs.open`, `show` and `openPreview` to the same methods on `HostTabs`;
  - `store.workspace` to `hostTabs.workspace`;
  - Ctrl+Tab and Ctrl+1..9 to `next`, `previous` and `goto`.
- The tab row renders `shared.tabs`, then `workspace.areas[n].tabs`. A split stays inside a host.
- "All hosts", the host colors and the compact tab button are UI work built on this module.
