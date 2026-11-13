# One module per daemon domain, so main.ts only lists domains (issue #2094)

## Context

`apps/daemon/src/main.ts` (819 lines on 2026-11-12, 2,865 when #1593 began) builds about 45 objects
from about 35 domains, hands them to `startServer`, starts them and stops them in one hand-written
sequence. Slices 1 to 18 of #1593 moved construction into domain factories (`<domain>/wiring.ts`)
and the server options into one group per domain (`serverGroup<K>()` in `server.ts`). Each domain
still costs `main.ts` an import, a construction line, a server key and often a start and a stop line.
Structure-only moves floor the file near 550 lines (#1593, comment 6812012709); #1593 asks for
under 400. The inputs this record starts from are in #2094 (comment 6812062141).

fd-coordinator chose the module interface over the 550-line target (2026-11-12, under the user's
standing rule to decide and tell after). The rules are the "Structure" section of the root
`CLAUDE.md` and `2026-11-09-domain-modules.md` (#1589).

## Decision

### 1. The module interface

A domain's `wiring.ts` factory returns its modules as plain objects, and the domain's `index.ts`
exports the factory. Most domains have one module; a factory whose parts stop at different times
returns one per part (`createBoardWork` builds the automations, the PR watch and the board sync).

```ts
// apps/daemon/src/server/module.ts
import type { ServerOptions } from "../server.ts";

export interface DomainModule<K extends keyof ServerOptions = never> {
  /** The domain's part of `startServer`'s options: its group, built with `serverGroup<K>()`. */
  server?: Pick<ServerOptions, K>;
  /** Work before the server listens. Awaited right after this module is added. */
  start?(): void | Promise<void>;
  /** Work that needs the server listening (loops that broadcast, WSL). Awaited in list order. */
  started?(): void | Promise<void>;
  /** Lets go of timers, children and handles. See "Start and stop order". */
  stop?(): void | Promise<void>;
  /** When the stop runs outside reverse construction order. Default "normal". */
  stopPhase?: "first" | "normal" | "late";
}
```

- A plain object, not a class: the factories already return plain objects, and the module is only
  how `main.ts` sees a domain. A class inside the domain (`Board` and its collaborators) stays as it is.
- `server` holds the domain's group under its `ServerOptions` key, so `main.ts` spreads every
  module's `server` into one `startServer` call. `serverGroup<K>()` keeps checking each group's
  members. A missing group is not a compile error, as today: every group key of `ServerOptions` is
  optional, and the domain's protocol tests catch a group that is not passed.
- The factory still returns the domain's own objects next to its modules when another domain needs
  them (`{ modules: [module], quota, onQuota }`). The module is the seam to `main.ts`, not the only export.
- The type and the runner (`createModuleRunner()`, with `add`, `server`, `started` and `stop`) live
  in `apps/daemon/src/server/module.ts`, exported by `server/index.ts`, with their own output test
  (`apps/daemon/test/server/module.test.ts`). `serverGroup<K>()` lives there too. Domains import
  the type and `serverGroup` from `server/index.ts`; `module.ts` imports `server.ts` with
  `import type` only, so no domain gains a runtime edge to `server.ts`.

### 2. Dependencies between domains

A factory takes what it needs as named fields of its deps object, as `createQuota({ db, config })`
does today. `main.ts` builds the modules in a written order, one line each; that order is the
dependency order. No container, no topological sort: the order is already a valid one (#2094
Context, point 2), and a sort would hide the stop order this record pins.

A dependency built later stays late-bound in the deps of the one factory that needs it, in the form
it has today: a getter (`() => T`), or a holder object `main.ts` fills once the other domain exists
(the session manager's `awake` hooks, filled with `central.meta` and `board.hasRunSession` after
both are built). Neither is a field of `DomainModule`: only a few domains need one, and a field on
every module would widen the interface for all of them.

Two import cycles cross a domain boundary (`depcruise`, 2026-11-11): `board/board.ts` with
`issues/issues.ts`, and `central/external-permissions.ts` with `permissions/auto-approve.ts`. The
modules of those four domains move only after their cycle is broken, each in its own PR.

### 3. Start and stop order

Start: the runner awaits each module's `start()` right after building it, before the next factory
runs, as `main.ts` does with `await maintenance.start()` today. A start that today is not awaited
(`void board.start()`, `void updates?.start()`, `history.start()`, `automations.start()`) keeps
that inside the module: its `start()` launches the work and returns without waiting, so the boot
does not wait on the board's git scan or the update check. Then `startServer`, then each
`started()` in list order: `wsl` and the board sync loop. Each slice checks that no factory it
moves reads state that a `start()` sets.

Stop: `main.ts` unwatches the config file (the watch stays in `main.ts`: it needs the server to
set a new token), then the runner stops the `"first"` modules in list order, the `"normal"` modules
in reverse construction order, then `server.stop()`, then the `"late"` modules in reverse
construction order; then `main.ts` closes the store, releases the lock and flushes the log. The
constraints this keeps, each with its cause in the code:

1. The config file unwatched and `keepAwake.stop()` (`"first"`) before anything else: a reload must
   not run during the stop, and a slow stop must not keep the computer awake.
2. `automations.stop()`, then `await automations.idle()`, before `board.stop()`: a tick or an issue
   search in flight uses the board and the store (5e36c5cbb). The automations' module `stop()` does
   both; reverse construction order puts it before the board, which is built first. Today the
   actions and the vault stop between the two calls; the automations reach neither, so that is
   written order only.
3. The PR watch and the board sync before `board.stop()`: both use the board. Reverse construction
   order gives this, since both are built after the board.
4. Every database writer before `store.close()`, `store.close()` before `lock.release()` (the lock
   guards the database), and `fileLog.flush()` last (the last lines reach the file). The lock and
   the store are not modules; the log is one only to hand the server its `fileLog`, and `main.ts`
   flushes it itself.
5. The stops that run after `server.stop()` today keep that place as `"late"` modules: the teleport
   and its inbox (#100: no transcript package outlives the daemon), `history`, the usage index, the
   budgets and the quota. Whether any of them must outlive the server is not shown by the code;
   keeping the place changes nothing.

Written order only, free to move: `await manager.shutdown()` before `server.stop()` (since
45775757e; `shutdown()` marks each run closing, so its end reaches no client either way, and the
runner keeps it since every module stops before the server); `await wsl?.stop()` third; the
messaging cluster (`names`, `teams`, `idle`, `messaging`, `endpoints` and the sweep interval);
`actions` and `vault`; the run env watchers; `terminals`; `central`; `telemetry`; `maintenance`;
`sleeper`; `stall`; `updates` and `autoUpdater`. The test that pins the order checks the five
constraints, not the written order.

### 4. What stays in main.ts

- `startDaemon`'s options for tests (`pty`, `resourcesProc`, `memoryReading`, `projectGit`,
  `portProbe`, `powerContext` and the rest) and their defaults.
- The config and its file watch, the file log, the lock and the store: opened before any module,
  closed after all.
- The runtime choice (`createRuntime`).
- The module list in construction order, the late-binding holders, `startServer` with the identity
  options (`hostName`, `bind`, `port`, `token`, `allowedRoots`, `allowedNetworks`) and the spread
  module groups, the calls to the runner, the boot log line, and the returned `Daemon`.
- `runCli`.

### 5. The size target

About 185 lines of `main.ts` are fixed (imports, options, config and its watch, log, lock, store,
runtime, `startServer`, the runner calls, `runCli`); the runner itself is in `server/module.ts`.
Each domain then costs its import and one or two lines in the list (its modules and the objects
another domain takes from it). With about 35 domains that is roughly 185 + 35 × 1.5, about 240
lines. Under 400 is reachable; #1593 measures it after the module slices.

**Amendment (fd-coordinator, 2026-11-12, on #1593):** the target for #1593 is at most 720 lines,
not the estimate above. There is no shared `core` deps object (the config, the log and the store
handed to every factory): a factory would receive dependencies it does not use, against the named
deps of section 2 and #1589's "nothing depends on what it does not use". Repeating the
`db`/`config`/`log` lines in the composition root is accepted. Constraints 2 and 3 are pinned at
module level by `apps/daemon/test/automations/wiring.test.ts` (the board work's stop waits for the
automations' drain before it stops the watch and the board sync's loop); the daemon-level pin of
the order comes with the slice that replaces the hand-written stop with the runner's.

### 6. The first slice

1. A `test(server)` commit with the runner's output test: start on add, a pending start holding the
   next module, the stop phases, an async stop awaited, the merged server groups. Red by assertion
   on a stub, before the runner.
2. The `DomainModule` type and the runner, and two domains with a stop and no cross-domain cycle
   moved onto it: `quota` and `telemetry`. While the hand-written stop sequence
   remains, `main.ts` calls each moved module's `stop()` at its current place, so the order does not
   change in this slice.
3. The pins of constraints 2 and 3 in `apps/daemon/test/daemon/stop-order.test.ts` (an issue
   search in flight when the stop begins finishes before the board stops; the watch and the board
   sync stop before the board) come first in the PR that moves the board work, green on the code
   before that move. Today the file pins only the keep-awake part of constraint 1; the log flush
   and the teleport are pinned in `apps/daemon/test/logs/server.test.ts` and
   `apps/daemon/test/teleport/bundle.test.ts`.
4. Later slices, one PR each: a few domains per PR, cycles first for board/issues and
   central/permissions, and last the PR that replaces the hand-written sequence with the runner's
   phases, with the stop-order test green before and after.

## Discarded alternatives

- **Keep structure-only moves to about 550 lines** (fd-architect's other proposal on #1593): no
  redesign, but every new domain still costs `main.ts` four or five lines, and #1593's goal moves.
- **A dependency-injection container or a topological sort of declared needs**: removes the written
  order, but the stop constraints are not dependency order (constraint 1 is about the computer and
  the config file, constraint 5 about the server), so they would come back as special cases, now
  hidden.
- **A class per domain with lifecycle methods**: adds `this` and a constructor to factories that
  are functions today, and nothing else.
- **A late-binding getter field on `DomainModule`**: every module would carry it for the few that
  need one.
- **Moving `startDaemon` to another file**: relocates the lines.

## Consequences

- Each module slice changes `main.ts`, the domain's `wiring.ts` and `index.ts`, and nothing else in
  behavior; the stop-order test and the existing domain tests stay green before and after.
- A new domain adds a factory that returns its modules and one line in the list.
- The stop sequence becomes data (phases and list order) once the last slice lands; until then the
  hand-written sequence stays and calls the moved modules' `stop()`.
- `stopPhase` is the only new rule a reader must learn; a stop constraint outside the five above
  needs a new record.
