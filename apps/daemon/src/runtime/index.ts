/**
 * The runtime domain's public entry (#1589): the engines that run a session, and the memoized
 * `claude --version` probe `host.info` reports. Another domain imports from here, never a file
 * inside.
 */
export { claudeVersionProbe } from "./claude-probe.ts";
export { VERIFIED_OPENCODE_VERSION } from "./opencode-config.ts";
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
