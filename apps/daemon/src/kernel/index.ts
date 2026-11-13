/**
 * The daemon's shared kernel (#1594): small helpers every domain uses and that know no domain
 * (the context map, `docs/decisions/2026-11-10-context-map.md`). Another domain imports from
 * here, never a file inside.
 */
export { AsyncQueue } from "./async-queue.ts";
export { writeFileAtomic } from "./atomic-write.ts";
export {
  type CommandResult,
  killTree,
  type LimitedMore,
  runCommand,
  runLimited,
} from "./command.ts";
export { API_KEY_VARS, buildChildEnv } from "./env.ts";
export { FlightdeckError, featureOff, refusalOf } from "./errors.ts";
export { type Exec, spawnExec } from "./exec.ts";
export { layoutLike, parseJsonOr, parseJsonText, parseJsonWith } from "./json-text.ts";
export { linesOf } from "./lines.ts";
export {
  AlreadyRunningError,
  acquireLock,
  EXIT_ALREADY_RUNNING,
  type Lock,
  readLockPid,
  withLock,
} from "./lock.ts";
export type { Logger } from "./logger.ts";
export { DEFAULT_ALLOWED_NETWORKS, ipInNetworks, parseCidr } from "./networks.ts";
export { ntfsName } from "./ntfs-name.ts";
export { isInside, resolveAllowedCwd, rootNames, samePath } from "./paths.ts";
export { present } from "./present.ts";
export { readRegular, readRegularSized } from "./read-regular.ts";
export { settled } from "./settled.ts";
export { tokenMatches } from "./token.ts";
export { trimEndOf, trimStartOf } from "./trim.ts";
export { ulid } from "./ulid.ts";
export { UNTRUSTED_MARK } from "./untrusted.ts";
export { DAEMON_VERSION } from "./version.ts";
export { whichOnPath } from "./which.ts";
