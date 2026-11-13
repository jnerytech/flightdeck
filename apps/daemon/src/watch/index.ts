/**
 * The PR watch domain's public entry (#1589): how the cards' PR watch is built, and the line that
 * replaces a secret-looking line of a check run's output. The board's check loop still imports
 * `check-run.ts` and `settings.ts` directly: through this entry it would close an import cycle (the
 * watch's trace reaches the board through the issues). Another domain imports from here.
 */

export { REMOVED_LINE } from "./check-run.ts";
export { createWatch, type WatchDeps } from "./wiring.ts";
