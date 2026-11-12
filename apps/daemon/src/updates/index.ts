/**
 * The updates domain's public entry (#1589, #2094): the release checker, the daemon's updater and
 * the auto updater, as the module `main.ts` adds. Another domain imports from here, never a file inside.
 */
export { createUpdates } from "./wiring.ts";
