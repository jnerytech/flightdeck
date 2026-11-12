# The store's host link moves out, and its session and vault methods go to their slices (issue #1596)

## Context

`apps/desktop/src/lib/app-store.ts` is 2,302 lines on `origin/main` on 2026-11-12 (after #2261;
the open permissions and assistant wires take about 15 more). The wiring decision
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
   `loadHostInfo` (the steps run when a host comes online), `reloadHostInfo`, `listenForWake`,
   `hostCommand`, `hostRequest`, `dispatch`, `watchChanges`, the latencies (`setLatency`,
   `getLatency` and their listener set), `openConnection`, and the connection half of `dispose`.
   It changes when the protocol gains a frame or a host feature.
2. **Session work that is not a slice yet** (about 340 lines): `select`, `watchSession`,
   `historyGet`, `historyList`, `resumeHistory`, `moveSession`, `closeTab`, `sendTo`, `setMeta`,
   `sessionRecap`, `recordFinished`, `countFinishedFiles`, `setFinished`, `onCard`. It changes when
   a session screen changes.
3. **Vault work** (about 75 lines): `vaultSecretFor`, `allowRoot`, `copySecret`.

`onLocalPath` (23 lines) is not vault work: it is the guard on a local path a screen opens
(absolute only, no `..`, the host's `canOpenPaths`), used by `openPath` and `revealPath`.

What remains (the notices, `init`, `dispose`, `update`, the clock helpers, the forwarders) is the
composition root's own work, or forwarders that fd-frontend removes per screen (fd-coordinator,
2026-11-11).

The fixed order of `loadHostInfo(hostId, conn, connect)` is behavior, and tests read it: the host
info first (and the end of a daemon update), then without waiting `refreshSetup(hostId, { connect
})` (always), the away activity (`activity`), the askpass watch (`ssh`), `watch.watch` (`watch`),
the teams watch and list (`teams`), `messages.watch` and the peers sync (`messaging`),
`vaultRules.onConnect` (`actions`), `health.check` (always), the resume offer
(`FEATURE_RESUME_OFFER`), and last, awaited, `budget.list` (`costs`). In parentheses: the host
feature that gates the step. `onStatus` runs it with `connect = true` on `online`, asks
`quota.get`, tells the terminals on any other status and drops partial text on `connecting`;
`reloadHostInfo` runs it with `connect = false`. `refreshSetup` uses the flag only for itself
(#721: on a connect it skips the cached projects and remembers the list); screens call it too.

## Decision

- **`features/hosts/link.ts`: `HostLink`**, the store's connections. It owns the `connections`
  map, `connect(config, token)`, `loadHostInfo`, `reloadHostInfo`, the wake listener,
  `connection(hostId)`, `watchChanges`, the latencies, `open(hostId)`, and the stop and removal
  of one host's connection (the status and the requests: below).
- **What changes outside the store's host methods, named**: `AppKernel` has no `connect`,
  `onStatus` or `loadHostInfo`, and there is no roster wire file: the roster slice is built in the
  constructor with `stop` and `detach` closures over the `connections` map, and `wireHostUpdate`'s
  `open` dep reaches it through `openConnection`. Both call the link instead. The other direct
  readers of the map (the teleport request, the permission answer, `select`, `watchSession`) go
  through `HostLink.connection`. The kernel's existing methods keep their signatures and delegate.
- **Screen-called methods stay on the store as forwarders**: `reloadHostInfo` (eight call sites:
  the bypass switch, the host pause, keep-awake and sleep panels, the host terminal, the status
  bar), `watchChanges` (`file-explorer.tsx`, `changes-panel.tsx`) and `refreshSetup` (the GitHub
  panel, the hosts and setup pages). A move PR edits no screen.
- **Frames go through an explicit route table**, `HostRoutes`, built once in the store from the
  slices and read by `HostLink` through a dep at each connect. Its type is derived from
  `HostConnectionOptions`, not written a second time: a mapped type over every key matching
  `on${string}` except `onStatus`, `onPing` and `onChangesUpdated` (the link keeps those), each
  key required, each callback given the host's config before the frame's own arguments (the
  vault request needs the host's URL, not only its id). Most frame callbacks there are optional
  (`onCardUpdated?`, `onQuotaUpdated?`, ...); a key list written by hand
  (`Required<Pick<..., "onA" | "onB">>`) would let a new one through silently, the mapped type does
  not: a frame kind added to `HostConnectionOptions` is a type error in the store's table literal
  until the table names its slice. The type gives no key list at run time: the link binds the
  table's own entries to the host. The link knows the protocol; the table knows which slice takes
  a frame.
- **The status stays the store's own route.** On every status the link calls the store's
  `onStatus(hostId, conn, status)` (the app log line, `updateHost` from `conn.lastDrop`,
  `conn.info`, `conn.incompatibility` and `conn.retry`, then on `online` `loadHostInfo` (the
  link's, once the on-line steps move) with `connect = true` and `quota.get`, `terminals.tellOffline` on any other status,
  `stream.dropPartialText` on `connecting`). Its order is behavior: `loadHostInfo` sends
  `host.info` before its first wait, so `host.info` goes out before `quota.get`, and a split
  where the link ran the store's status work first and its own on-line steps after would swap
  them. The link keeps the latency (the ping) itself.
- **What else the link reads of the rest of the app is a dep, named here**: the token is
  remembered for the scan (`scan.rememberToken`); the sessions to subscribe on connect (the
  selected one and the watched ones); `lastSeqFor`. The changes and latency listener sets move
  with the link. `hostCommand`, `hostRequest` and `dispatch` stay in the store for now: they
  report to the banner (`fail`) and feed the cards and runs of a result to `onCard` and `onRun`,
  both still store methods; they move with those.
- **The on-line steps are one ordered list**, `OnlineStep[]`, built in the store next to the route
  table, in today's order, each step `{ gate?: string; run(ctx: { hostId, conn, hostInfo,
  connect }): void | Promise<void> }`, the gate a feature name of `host.info`. The first step
  records the answer on the host (and ends a daemon update that reached its target).
  `HostLink.loadHostInfo` asks for `host.info` and runs the steps whose gate the host has, every
  one started without waiting except a step marked `awaited` (the budgets), awaited when it runs; `connect` reaches the setup
  step, which passes it to `refreshSetup`, and nothing else. `refreshSetup` stays a store method;
  it runs no on-line step. The order lives in one place a reviewer reads top to bottom.
- **Session methods go to the sessions domain** (`features/sessions/`): history (`historyGet`,
  `historyList`, `resumeHistory`) to `HistorySlice`, with the history's own constants and filter
  type (`HISTORY_PAGE`, `HistoryFilter`), which `app-state.ts` re-exports (the slice takes the sessions domain's `HISTORY_LIST_LIMIT` and the connection's error from the store, so it imports neither entry and adds no cycle); the finished list (`recordFinished`,
  `countFinishedFiles`, `setFinished`) to a `FinishedSlice` next to `finished.ts`. The others
  (`select`, `watchSession`, `moveSession`, `closeTab`, `sendTo`, `setMeta`, `sessionRecap`,
  `onCard`) have no home yet: see the open questions. **Vault methods go to the vault slices.**
  One slice per PR, through its wire file.
- **Methods screens call stay on the store as forwarders** (`select`, `closeTab`, `moveSession`,
  `sendTo`, ...): the move puts the body in the slice and leaves a one-line forwarder, which
  fd-frontend removes per screen under the 2026-11-11 rule.
- **The remaining methods go by domain** to the slice of their domain: the platform helpers
  (`saveFile`, `copyText`, `pickFolder`, `openPath`, `revealPath`, ...) with the `onLocalPath`
  guard to `features/shell/` (`SystemSlice` in `system.ts`; whether a host is local is a dep,
  so the shell imports no terminal entry); the UI mode and tab methods (`uiMode`, `toggleUiMode`,
  `setUiChoice`, `setHostUi`, `openNewTab`, `uiHostId`) to the host tabs; the palette
  (`loadPalette`, `paletteRecents`, `recordPaletteUse`) to the palette; the runs (`runEnvConfig`,
  `runTrust`, `runStart`, `runStop`, `onRun`, `onRunEnv`) to their wire; messaging (`relayDeps`,
  `onTeams`, `onTeamsUpdated`, `onMessageUpdated`, `startPeersSync`) to messaging; the requests
  (`onOpenRequest`, `openRequest`, `decideOldest`, `respondTo`, `respond`, with the open-request
  listener set) to permissions; the quiet snooze to sessions.
- **The initial state literal** moves to `lib/app-state.ts` as `initialAppState(...)`, next to
  `app-store.ts`: it is the composition root's own data, one key per slice, so it has no domain of
  its own; it is a recorded exception to the folders-by-domain rule, as `app-store.ts` is, and
  leaves `lib/` with it. Each top-level helper moves with the only group that uses it.
- The store keeps `init`, `dispose`, `update`, the notices, the route table and the on-line steps:
  the composition root.

Each step is its own structural PR, behavior unchanged, tests green before and after, in this
order: the route table and `HostLink` (largest share), then the session groups, then the vault
group, then the domain groups. `app-store.ts` is measured after each.

The budget, from the 2,302 lines of 2026-11-12:

| Cut | Lines |
| --- | ---: |
| last wire blocks | -100 |
| host link | -330 |
| session history and finished list | -180 |
| vault group | -75 |
| forwarders (fd-frontend) | -210 |
| domain groups (above; estimate, some methods are longer than 14 lines) | -350 |
| initial state literal | -50 |
| top-level helpers | -100 |
| imports that leave with the moved code (estimate) | -100 |
| route table and on-line step list, added | +100 |
| forwarders kept for screens until fd-frontend removes them | +30 |
| **Left, decided cuts** | **about 940** |
| session methods without a home yet (open question) | -160 |
| **Left, once they move** | **about 780** |

So the decided cuts leave about 940 lines, over the 800 line; the session methods of the open
question bring it to about 780. Without fd-frontend's forwarder removals, add about 210. The
measurement after the last group names the next cut (the fields only one slice uses, the
remaining short methods); it is never a new hub.

## Discarded

- **Handler registration** (each wire file calls `link.on("quota", ...)` and `link.onOnline(step)`).
  Fewer lines in the store, but the frame routing and the on-line order would follow the order the
  wire files run in: an implicit order, easy to break by moving one constructor line, for steps
  whose order is behavior. A missing handler would also be silent, where the table is a type error.
- **An event bus between the link and the slices.** The same implicit order, plus a string-keyed
  indirection the type checker cannot follow; nothing in the app needs more than one listener per
  frame kind beyond the six listener sets the store already has (messages, changes, history,
  teams, latency, open requests).
- **Leave the methods and stop at the wiring.** `app-store.ts` stays near 1,700 lines, the #1596
  goal and the CLAUDE.md size rule are not met, and every new frame or host feature keeps editing
  the composition root.
- **Split `app-store.ts` into partial files by line ranges** (`app-store-hosts.ts` extending a base
  class). The file count goes up, the class does not get smaller, and the reasons to change stay
  mixed in one class: a shallow split.

## Open questions

- **Where the selection and the session actions go.** `select` and `watchSession` subscribe and
  unsubscribe on the host connections and set `selected`. `SessionStreamSlice` does not handle
  subscriptions today; it takes the frames. Either it grows the subscriptions, or a new
  `SessionSelection` slice owns them and keeps the stream to frames. `moveSession`, `closeTab`,
  `sendTo`, `setMeta`, `sessionRecap` and `onCard` follow from that choice. Decided in that PR,
  after reading `stream.ts`, and recorded in its body.

## Consequences

- `HostLink` is the only place that builds a `HostConnection`; its tests can drive a fake
  connection without a whole store. The store's existing connection tests stay the safety net of
  the move.
- `HostRoutes` and `OnlineStep` are new public types of the hosts domain. The route table is the
  one place a new frame kind is wired, by design: it is a list, not logic, so its size (with the
  on-line steps, about 100 lines, the figure in the budget) is accepted in the store.
- `AppKernel`'s existing host methods keep their signatures and delegate; the roster block and
  `wireHostUpdate`'s `open` dep are the parts outside the host methods that change.
- The six listener sets move with the link or the slice that owns their frames; their subscribers
  do not change.
