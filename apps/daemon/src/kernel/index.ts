/**
 * The daemon's shared kernel (#1594): small helpers every domain uses and that know no domain
 * (the context map, `docs/decisions/2026-11-10-context-map.md`). Another domain imports from
 * here, never a file inside.
 */
export { AsyncQueue } from "./async-queue.ts";
export { API_KEY_VARS, buildChildEnv } from "./env.ts";
export { type Exec, spawnExec } from "./exec.ts";
export { linesOf } from "./lines.ts";
export type { Logger } from "./logger.ts";
export { ntfsName } from "./ntfs-name.ts";
export { present } from "./present.ts";
export { settled } from "./settled.ts";
export { trimEndOf, trimStartOf } from "./trim.ts";
export { ulid } from "./ulid.ts";
export { DAEMON_VERSION } from "./version.ts";
export { whichOnPath } from "./which.ts";
