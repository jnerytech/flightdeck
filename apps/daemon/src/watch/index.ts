/**
 * The PR watch domain's public entry (#1589). It exports, for now, only how the cards' PR watch is
 * built; the rest of the domain moves behind this entry with the remaining deep imports. Another
 * domain imports from here.
 */

export { createWatch, type WatchDeps } from "./wiring.ts";
