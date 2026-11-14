/**
 * The checkpoints domain's public entry (#1589): the git snapshots of a session's turns, rewinding
 * to one and forking from one. Other domains import only from here. `wiring.ts` stays out: it
 * imports `server/index.ts`, so through this entry its importers would reach the server back in a
 * cycle; `main.ts`, outside any domain, takes `createCheckpoints` from it. `fork.ts` stays out
 * too: it reaches `central/` through `personas/` (#1601); `server-options.ts` takes `Forker` from it.
 */
export type { Rewinder } from "./rewind.ts";
export { type SnapshotInput, Snapshots, snapshotForHook } from "./snapshots.ts";
export { withTurnUuids } from "./turn-uuid.ts";
