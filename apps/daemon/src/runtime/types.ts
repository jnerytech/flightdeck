import type { PermissionMode, SessionEvent, ToolInput } from "@flightdeck/protocol";

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
  | { behavior: "allow"; updatedInput?: ToolInput }
  | { behavior: "deny"; message: string };

export type CanUseToolFn = (
  toolName: string,
  input: ToolInput,
  ctx: { signal: AbortSignal; toolUseId?: string },
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

export interface AgentRun {
  /** Normalized events; ends when the run is closed and throws if the runtime fails. */
  events: AsyncIterable<RuntimeEvent>;
  /** Next user message. */
  send(text: string): void;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentRuntime {
  start(opts: StartOptions): AgentRun;
}
