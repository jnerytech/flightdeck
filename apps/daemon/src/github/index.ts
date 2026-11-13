/**
 * The github domain's public entry (#1589, #1612). It exports, for now, only what another domain
 * asks of `gh`: the closed-issue count the ROI signals use. The rest of the domain moves behind
 * this entry with the remaining deep imports. Another domain imports from here.
 */

export { type ClosedIssues, closedIssues } from "./adapters/issues-closed.ts";
