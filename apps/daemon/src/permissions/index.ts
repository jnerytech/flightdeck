/**
 * The permission domain's public entry (#1589): permission requests, risk, auto-approval and the
 * rules behind them. Another domain imports from here, never a file inside.
 */

export { runAnswerCli } from "./answer-cli.ts";
export { Approvers } from "./approvers.ts";
export { type AutoApproveRequest, type AutoApprover, historyExcludes } from "./auto-approve.ts";
export type { ApprovalGate } from "./domain/approval-gate.ts";
export { bindInput, summarizeInput } from "./domain/bind-input.ts";
export type { PermissionDecision } from "./domain/decision.ts";
export { requireHold } from "./domain/hold.ts";
export { maskConfig, maskedConfig } from "./domain/mask-config.ts";
export {
  checkUpdates,
  isProjectRule,
  parseSuggestions,
  rulePaths,
  ruleReadings,
} from "./domain/permission-updates.ts";
export { isCredentialPath, type Risk, RiskClassifier } from "./domain/risk.ts";
export { type DiskView, writeTarget } from "./domain/rule-risk.ts";
export { credential, credentialReadGlobs } from "./domain/sensitive-paths.ts";
export { realPathOf, statKind } from "./path-kind.ts";
export { PermissionBroker } from "./permission-broker.ts";
export type { PermissionJudgeRequest, PermissionJudgeVerdict } from "./ports.ts";
export { runRequestsCli } from "./requests-cli.ts";
export { pathKinds, realPaths } from "./rule-risk.ts";
