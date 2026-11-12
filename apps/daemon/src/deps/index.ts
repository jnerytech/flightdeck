/**
 * The dependency domain's public entry (#1589): the tools a host needs, probed and reported.
 * The doctor checks the daemon's own setup.
 * Another domain imports from here, never a file inside.
 */
export { checkDeps, type DepsEnv } from "./deps.ts";
export { runDoctor } from "./doctor.ts";
export { doctorExitCode, formatDeps } from "./format.ts";
export { probeVersion } from "./probe.ts";
