import type { UsageTokens } from "../kernel/index.ts";

/** Phase 13: a short isolated query that judges one permission request. */
export interface PermissionJudgeRequest {
  model: string;
  prompt: string;
  /** A folder of its own, excluded from the history. */
  cwd: string;
  signal?: AbortSignal;
}

export interface PermissionJudgeVerdict {
  decision: "allow" | "ask" | "deny";
  reason: string;
  /** What the query used, for the costs; absent when the engine does not know. */
  tokens?: UsageTokens;
}

/** What the automatic approval needs of an engine: the AI that judges a request, when it has one. */
export interface PermissionJudge {
  judgePermission?(request: PermissionJudgeRequest): Promise<PermissionJudgeVerdict>;
}
