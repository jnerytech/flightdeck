/**
 * The board sync domain's public entry (#1589). It exports, for now, only how the GitHub Projects'
 * boards sync is built; the rest of the domain moves behind this entry with the remaining deep
 * imports. Another domain imports from here.
 */

export { type BoardSyncDeps, createBoardSync } from "./wiring.ts";
