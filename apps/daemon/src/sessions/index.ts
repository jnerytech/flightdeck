/**
 * The sessions' public entry (#1589): the manager of the live Claude Code sessions. Another domain
 * imports from here, never a file inside. Only main.ts reaches the wiring (./wiring.ts) directly:
 * re-exporting it here would close import cycles through the domains it wires.
 */
export type { SessionManager } from "./session-manager.ts";
