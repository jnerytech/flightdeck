import type {
  McpLiveStatus,
  PermissionMode,
  PermissionUpdate,
  SessionEvent,
  ToolInput,
} from "@flightdeck/protocol";
import type { UsageTokens } from "../costs/usage-indexer.ts";

/** One window of the plan quota, as a runtime read it (`resetsAt` in milliseconds). */
export interface QuotaReading {
  window: string;
  utilization: number | null;
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt: number | null;
}

/**
 * Events a runtime may emit; the session manager adds the lifecycle ones itself. `quota` is
 * the host's, not the session's: it never becomes a session event.
 */
export type RuntimeEvent =
  | Exclude<
      SessionEvent,
      {
        type: "session.created" | "session.status" | "permission.requested" | "permission.resolved";
      }
    >
  | { type: "quota"; windows: QuotaReading[] };

export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: ToolInput; updatedPermissions?: PermissionUpdate[] }
  | { behavior: "deny"; message: string };

export type CanUseToolFn = (
  toolName: string,
  input: ToolInput,
  /** `suggestions` as the CLI sent them; the session manager validates them. */
  ctx: { signal: AbortSignal; toolUseId?: string; suggestions?: unknown },
) => Promise<PermissionDecision>;

export interface StartOptions {
  cwd: string;
  resume?: string;
  permissionMode: PermissionMode;
  model?: string;
  /** Already sanitized environment for the agent process. */
  env: Record<string, string>;
  canUseTool: CanUseToolFn;
}

/** What the SDK's `Query.rewindFiles` answers (phase 12). */
export interface RewindFilesResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

export interface AgentRun {
  /** Normalized events; ends when the run is closed and throws if the runtime fails. */
  events: AsyncIterable<RuntimeEvent>;
  /** Next user message; `uuid` names it in the transcript (the turn the SDK rewinds to). */
  send(text: string, uuid?: string): void;
  /** Phase 12: the SDK's file checkpoint back to before the message `userMessageId`. */
  rewindFiles?(userMessageId: string, opts: { dryRun: boolean }): Promise<RewindFilesResult>;
  /** Phase 12: turns an MCP server of the live session on or off. */
  toggleMcpServer?(name: string, enabled: boolean): Promise<void>;
  /** Phase 12: the live status of the session's MCP servers. */
  mcpServerStatus?(): Promise<McpLiveStatus[]>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

/** Options of the SDK's `forkSession` (phase 12). */
export interface ForkOptions {
  upToMessageId?: string;
  /** Project folder whose transcripts hold the session. */
  dir?: string;
}

/** Phase 13: a short isolated query that judges one permission request. */
export interface JudgeOptions {
  model: string;
  prompt: string;
  /** A folder of its own, excluded from the history. */
  cwd: string;
  signal?: AbortSignal;
}

export interface JudgeResult {
  decision: "allow" | "ask" | "deny";
  reason: string;
  /** What the query used, for the costs; absent when the runtime does not know. */
  tokens?: UsageTokens;
}

export interface AgentRuntime {
  start(opts: StartOptions): AgentRun;
  /** Phase 13: the AI of the automatic approval. */
  judgePermission?(opts: JudgeOptions): Promise<JudgeResult>;
  /** Phase 12: copies a transcript (up to a message) into a new session, resumable by its id. */
  forkSession?(claudeSessionId: string, options: ForkOptions): Promise<{ sessionId: string }>;
}
