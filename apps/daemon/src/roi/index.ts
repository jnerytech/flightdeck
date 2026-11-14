/**
 * The roi domain's public entry (#1589): what the board's finished cards and their signals say
 * about the time Flightdeck saves. Other domains import only from here. `wiring.ts` stays out:
 * it imports `server/index.ts`, so through this entry every importer would reach the server back
 * in a cycle; `main.ts`, outside any domain, takes `createRoi` from it.
 */
export { type DoneVia, forgetDone, recordDone } from "./done-log.ts";
export { RoiSummarizer, roiPeriod } from "./summary.ts";
