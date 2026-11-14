/**
 * The permission domain's public entry (#1589): permission requests, risk, auto-approval and the
 * rules behind them. Another domain imports from here, never a file inside.
 */
export { type AutoApproveRequest, type AutoApprover, historyExcludes } from "./auto-approve.ts";
export { bindInput, summarizeInput } from "./domain/bind-input.ts";
export {
  checkUpdates,
  isProjectRule,
  parseSuggestions,
  rulePaths,
  ruleReadings,
} from "./domain/permission-updates.ts";
export { credential, credentialReadGlobs } from "./domain/sensitive-paths.ts";
export { requireHold } from "./hold.ts";
export { maskConfig, maskedConfig } from "./mask-config.ts";
export { realPathOf, statKind } from "./path-kind.ts";
export { PermissionBroker } from "./permission-broker.ts";
export { isCredentialPath, type Risk, RiskClassifier } from "./risk.ts";
export { type DiskView, pathKinds, realPaths, writeTarget } from "./rule-risk.ts";
