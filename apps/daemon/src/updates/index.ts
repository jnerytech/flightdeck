/**
 * The updates domain's public entry (#1589, #2094): the release checker, the daemon's updater and
 * the auto updater, as the module `main.ts` adds, and the `update check|apply` runner (#3780). Another domain
 * imports from here, never a file inside.
 */
export { runUpdateCli, type UpdateCliArgs } from "./update-cli.ts";
export { createUpdates } from "./wiring.ts";
