# The store's host link moves out, and its session and vault methods go to their slices (issue #1596)

## Context

`apps/desktop/src/lib/app-store.ts` is 2,302 lines on `origin/main` on 2026-11-12 (after #2261; the open permissions and assistant wires take about 15 more). The wiring decision
(`2026-11-11-app-store-wiring.md`) moved most slice ports into `features/<domain>/wire.ts`; the
blocks still in the constructor (roster, host tabs, assistant, webhooks, ROI, permissions) are
about 100 lines. That decision left the rest to "a hub split, as its own decision": this one.

What the file holds now, measured on `origin/main`:

- imports, about 210 lines; top-level helpers, about 100; fields, about 75; the constructor,
  about 460 (of them the 51-line initial `this.state` literal);
- 115 methods, about 1,460 lines: 43 of six lines or fewer (most forward to a slice, about 210
  lines), 40 of seven to fourteen (about 400), 32 of fifteen or more (about 840).

The large methods fall into three groups by reason to change:

1. **The host link** (about 330 lines): `connect` (86: builds a `HostConnection`, routes 23 frame
   kinds to slices, subscribes the selected and watched sessions, starts nine watches), `onStatus`,
   `loadHostInfo` (the steps run when a host comes online), `listenForWake`, `hostCommand`,
   `hostRequest`, `dispatch`, `refreshSetup`, `watchChanges`, `setLatency`, `openConnection`, and
   the connection half of `dispose`. It changes when the protocol gains a frame or a host feature.
2. **Session work that is not a slice yet** (about 290 lines): `select`, `watchSession`,
   `historyGet`, `historyList`, `resumeHistory`, `moveSession`, `closeTab`, `sendTo`, `setMeta`,
   `sessionRecap`, `recordFinished`, `countFinishedFiles`, `setFinished`, `onCard`. It changes when
   a session screen changes.
3. **Vault work** (about 90 lines): `vaultSecretFor`, `onLocalPath`, `allowRoot`, `copySecret`.

What remains (the notices, `init`, `dispose`, `update`, the clock helpers, the forwarders) is the
composition root's own work, or forwarders that fd-frontend removes per screen (fd-coordinator,
2026-11-11).

The fixed order of `loadHostInfo` is behavior, and tests read it: the host info first (and the
end of a daemon update), then without waiting `refreshSetup`, the away activity, the askpass watch,
`watch.watch`, the teams watch and list, `messages.watch` and the peers sync, `vaultRules.onConnect`,
`health.check`, the resume offer, and last, awaited, `budget.list`. `onStatus` runs it on
`online`, asks `quota.get`, tells the terminals on any other status and drops partial text on
`connecting`.

## Decision

- **`features/hosts/link.ts`: `HostLink`**, the store's connections. It owns the `connections`
  map, `connect(config, token)`, `onStatus`, `loadHostInfo`, the wake listener, `hostCommand`,
  `hostRequest`, `dispatch`, `connection(hostId)`, `reloadHostInfo`, `watchChanges`, and the
  stop and removal of one host's connection (today the roster's `detach` and `stop` mutate the
  `connections` map directly; they call the link instead). The kernel's existing methods keep
  their signatures and delegate. `AppKernel` has no `connect`, `onStatus` or `loadHostInfo` today,
  so the roster wire that reaches them through the store changes with this move.
- **`watchChanges` stays on the store as a forwarder**: screens call it (`file-explorer.tsx` and
  `changes-panel.tsx`), and a move PR edits no screen.
- **Frames go through an explicit route table**, `HostRoutes`, built once in the store from the
  slices and passed to `HostLink` as a dep. Its type is derived from `HostConnectionOptions`, not
  written a second time: a mapped type over every key matching `on${string}`, made required (`-?`),
  each callback given the connection's host id and the connection itself before the frame's own
  arguments. Most frame callbacks there are optional (`onCardUpdated?`, `onQuotaUpdated?`, ...);
  a key list written by hand (`Required<Pick<..., "onA" | "onB">>`) would let a new one through
  silently, the mapped type does not: a frame kind added to `HostConnectionOptions` is a type error
  in the store's table literal until the table names its slice. The routes get the connection
  because `onStatus` and `onPing` read its state today (`lastDrop`, `info`, `incompatibility`,
  `retry`, `latencyMs`). The link knows the protocol; the table knows which slice takes a frame.
- **What the link reads of the rest of the app is a dep, named here**: the token is remembered for
  the scan (`scan.rememberToken`); the sessions to subscribe on connect (the selected one and the
  watched ones); `lastSeqFor`; the reactions to a status (`updateHost`, the app log line,
  `terminals.tellOffline`, `stream.dropPartialText`, `quota.get` on `online`), which go in the
  route table as `onStatus` so the link stays protocol-only; the handlers `dispatch` feeds with the
  cards and runs of a result. `refreshSetup` stays a store method the setup step calls;
  the changes listener set moves with the link (it is fed by the `onChangesUpdated` route).
- **The on-line steps are one ordered list**, `OnlineStep[]`, built in the store next to the route
  table, in today's order, each step `{ run: (hostId, conn, hostInfo) => void | Promise<void>; gate?: feature; connect:
  boolean }`. The `connect` flag marks the steps `refreshSetup` repeats after a setup change (#721):
  it runs the flagged subset in the same order, so the two paths share one list. `HostLink.loadHostInfo` runs the list as today: every step started without waiting,
  except the last, awaited. The order lives in one place a reviewer reads top to bottom.
- **Session methods go to the sessions domain** (`features/sessions/`): history (`historyGet`,
  `historyList`, `resumeHistory`) to `HistorySlice`; the finished list (`recordFinished`,
  `countFinishedFiles`, `setFinished`) to a `FinishedSlice` next to `finished.ts`. **Vault methods
  go to the vault slices.** One slice per PR, through its wire file.
- **Methods screens call stay on the store as forwarders** (`select`, `closeTab`, `moveSession`,
  `sendTo`, ...): the move puts the body in the slice and leaves a one-line forwarder, which
  fd-frontend removes per screen under the 2026-11-11 rule. A move PR edits no screen.
- **The 7-to-14-line methods go by group** to the slice of their domain: the platform helpers
  (`saveFile`, `copyText`, `pickFolder`, `openPath`, ...) to `features/shell/`; the UI mode and
  tab methods (`uiMode`, `toggleUiMode`, `setUiChoice`, `setHostUi`, `openNewTab`, `uiHostId`) to
  the host tabs; the palette (`loadPalette`, `paletteRecents`, `recordPaletteUse`) to the palette;
  the runs (`runEnvConfig`, `runTrust`, `runStart`, `runStop`, `onRun`, `onRunEnv`) to their wire;
  messaging (`relayDeps`, `onTeams`, `onTeamsUpdated`, `onMessageUpdated`, `startPeersSync`) to
  messaging; the requests (`onOpenRequest`, `openRequest`, `decideOldest`, `respondTo`, `respond`)
  to permissions; the quiet snooze to sessions.
- **The initial state literal** moves to `lib/app-state.ts` as `initialAppState(...)`, and each
  top-level helper moves with the only group that uses it.
- The store keeps `init`, `dispose`, `update`, the notices and the route table: the composition root.

Each step is its own structural PR, behavior unchanged, tests green before and after, in this
order: the route table and `HostLink` (largest share, no screen touches it), then the session
groups, then the vault group, then the 7-to-14-line groups. `app-store.ts` is measured after each.

The budget, from the 2,302 lines of 2026-11-12:

| Cut | Lines |
| --- | ---: |
| last wire blocks | -100 |
| host link | -330 |
| session groups | -290 |
| vault group | -90 |
| forwarders (fd-frontend) | -210 |
| 7-to-14-line groups (above) | -350 |
| initial state literal | -50 |
| top-level helpers | -100 |
| imports that leave with the moved code (estimate) | -100 |
| route table and on-line step list, added | +100 |
| forwarders kept for screens until fd-frontend removes them | +30 |
| **Left** | **about 820** |

So these cuts reach about 820, over the 800 line, and about 1,030 if fd-frontend's forwarder
removals do not land first. The measurement after the last group names
the next cut (the fields only one slice uses, the remaining short methods); it is never a new hub.

## Discarded

- **Handler registration** (each wire file calls `link.on("quota", ...)` and `link.onOnline(step)`).
  Fewer lines in the store, but the frame routing and the on-line order would follow the order the
  wire files run in: an implicit order, easy to break by moving one constructor line, for steps
  whose order is behavior. A missing handler would also be silent, where the table is a type error.
- **An event bus between the link and the slices.** The same implicit order, plus a string-keyed
  indirection the type checker cannot follow; nothing in the app needs more than one listener per
  frame kind beyond the four listener sets the store already has (messages, changes, history,
  teams).
- **Leave the methods and stop at the wiring.** `app-store.ts` stays near 1,700 lines, the #1596
  goal and the CLAUDE.md size rule are not met, and every new frame or host feature keeps editing
  the composition root.
- **Split `app-store.ts` into partial files by line ranges** (`app-store-hosts.ts` extending a base
  class). The file count goes up, the class does not get smaller, and the reasons to change stay
  mixed in one class: a shallow split.

## Open questions

- **Where the selection goes.** `select` and `watchSession` subscribe and unsubscribe on the host
  connections and set `selected`. `SessionStreamSlice` does not handle subscriptions today; it
  takes the frames. Either it grows the subscriptions, or a new `SessionSelection` slice owns them
  and keeps the stream to frames. Decided in that PR, after reading
  `stream.ts`, and recorded in its body.

## Consequences

- `HostLink` is the only place that builds a `HostConnection`; its tests can drive a fake
  connection without a whole store. The store's existing connection tests stay the safety net of
  the move.
- `HostRoutes` and `OnlineStep` are new public types of the hosts domain. The route table is the
  one place a new frame kind is wired, by design: it is a list, not logic, so its size (with the
  on-line steps, about 100 lines, the figure in the budget) is accepted in the store.
- `AppKernel`'s existing host methods keep their signatures and delegate; the roster wire is the
  one wire file that changes.
- The four listener sets (messages, changes, history, teams) move with the link or the slice that owns
  their frames; their subscribers do not change.
