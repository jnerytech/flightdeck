/**
 * The dependency domain's public entry (#1589): the tools a host needs, probed and reported.
 * Another domain imports from here, never a file inside.
 */
export { checkDeps, type DepsEnv } from "./deps.ts";
export { doctorExitCode, formatDeps } from "./format.ts";
export { probeVersion } from "./probe.ts";
