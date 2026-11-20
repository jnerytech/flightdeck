/**
 * The quota domain's public entry (#1589): the plan's usage windows that hold new work, the timers
 * that wake it, and the local day the usage ledger counts by. Another domain imports from here,
 * never a file inside.
 */

export type { QuotaCliArgs } from "./domain/quota-cli-view.ts";
export { quotaReadings } from "./domain/readings.ts";
export { Quota, realTimers, type Timers } from "./quota.ts";
export { runQuotaCli } from "./quota-cli.ts";
export { localDay } from "./usage.ts";
