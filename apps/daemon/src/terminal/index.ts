/**
 * The terminal domain's public entry (#1589): the terminals the daemon opens on a host, and the sink
 * a client's transport hands them for their frames. `main.ts` still builds the domain through
 * `wiring.ts`. Another domain imports from here, never a file inside.
 */
export type { TerminalManager, TerminalSink } from "./terminal-manager.ts";
