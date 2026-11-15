/**
 * The PR watch domain's public entry (#1589): how the cards' PR watch is built, the line that
 * replaces a secret-looking line of a check run's output, and the settings and check runner the
 * board's check loop uses. The watch asks the board only through its own port (`ports.ts`), so
 * this entry closes no cycle. Another domain imports from here.
 */

export { REMOVED_LINE, runChecks } from "./domain/check-run.ts";
export type { WatchSettings } from "./settings.ts";
export { createWatch, type WatchDeps } from "./wiring.ts";
