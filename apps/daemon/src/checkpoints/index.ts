/**
 * The checkpoints domain's public entry (#1589): the git snapshots of a session's turns, rewinding
 * to one and forking from one. Other domains import only from here, except two that `wiring.ts`
 * (loaded by this entry) reaches back through `server/index.ts`, a cycle for dependency-cruiser:
 * `central/central.ts` takes `snapshotForHook` from `snapshots.ts`, and `server-options.ts` takes
 * its types from `fork.ts`, `rewind.ts` and `snapshots.ts`.
 */
export { Snapshots } from "./snapshots.ts";
export { withTurnUuids } from "./turn-uuid.ts";
export { createCheckpoints } from "./wiring.ts";
