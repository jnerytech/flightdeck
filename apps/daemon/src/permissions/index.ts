/**
 * The permission domain's public entry (#1589): permission requests, risk, auto-approval and the
 * rules behind them. Another domain imports from here, never a file inside.
 */
export { type AutoApprover, historyExcludes } from "./auto-approve.ts";
export { summarizeInput } from "./bind-input.ts";
export type { PermissionBroker } from "./permission-broker.ts";
export { parseSuggestions } from "./permission-updates.ts";
export type { RiskClassifier } from "./risk.ts";
export { credential } from "./sensitive-paths.ts";
