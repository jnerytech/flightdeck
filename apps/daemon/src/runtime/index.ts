/**
 * The runtime domain's public entry (#1589): the engines that run a session, and the memoized
 * `claude --version` probe `host.info` reports. Another domain imports from here, never a file
 * inside. Two importers still reach in: `review/card-review.ts` takes `CompleteCutShort` from
 * `claude-sdk-runtime.ts` (that file imports quota, which imports this entry), and
 * `permissions/permission-broker.ts` takes `PermissionDecision` from `types.ts` (this entry loads
 * `opencode-config.ts`, which imports permissions).
 */
export { claudeVersionProbe } from "./domain/claude-probe.ts";
export { VERIFIED_OPENCODE_VERSION } from "./opencode-config.ts";
export type { OpenCodeInfo } from "./opencode-discovery.ts";
export { findingText, type ScopeFinding } from "./opencode-scope.ts";
export { type OpenCodeState, openCodeState } from "./opencode-wiring.ts";
export type {
  AgentRun,
  AgentRuntime,
  CompleteOptions,
  CompleteResult,
  PermissionDecision,
  QuotaReading,
  RewindFilesResult,
  RuntimeEvent,
} from "./types.ts";
