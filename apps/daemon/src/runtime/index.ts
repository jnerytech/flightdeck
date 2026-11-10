/**
 * The runtime domain's public entry (#1589): the engines that run a session. Another domain
 * imports from here, never a file inside.
 */
export { openCodeState } from "./opencode-wiring.ts";
