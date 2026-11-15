/**
 * The runtime domain's public entry (#1589): the engines that run a session, and the memoized
 * `claude --version` probe `host.info` reports. Another domain imports from here, never a file
 * inside. Two importers still reach in: `permissions/permission-broker.ts` takes
 * `PermissionDecision` and `permissions/auto-approve.ts` takes `AgentRuntime`, both from
 * `types.ts` (this entry loads `domain/opencode-config.ts`, which imports permissions).
 */
export { CompleteCutShort } from "./domain/complete-cut-short.ts";
export { VERIFIED_OPENCODE_VERSION } from "./domain/opencode-config.ts";
export type { OpenCodeInfo } from "./opencode-discovery.ts";
export { findingText, type ScopeFinding } from "./opencode-scope.ts";
export { type OpenCodeState, openCodeState } from "./opencode-wiring.ts";
export type {
  AgentRun,
  AgentRuntime,
  CompleteOptions,
  CompleteResult,
  QuotaReading,
  RewindFilesResult,
  RuntimeEvent,
} from "./types.ts";
