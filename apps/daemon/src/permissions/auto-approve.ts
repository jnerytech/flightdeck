/** Stub. */
import type { Database } from "bun:sqlite";
import type { UsageTokens } from "../costs/usage-indexer.ts";
import type { AgentRuntime } from "../runtime/types.ts";
import type { Risk } from "./risk.ts";

export interface AutoApproveSettings {
  enabled: boolean;
  model: string;
  lowWithoutAi: boolean;
}

export interface AutoApproveRequest {
  /** The managed session's id, or the terminal session's Claude id. */
  sessionKey: string;
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  risk: Risk;
}

export interface AutoDecision {
  decision: "allow" | "ask";
  reason: string;
  /** `rule` (low without AI, or never-automatic), `ai` (the model answered). */
  by: "rule" | "ai";
  model: string | null;
}

export interface AutoApprovalRecord {
  id: string;
  projectId: string;
  sessionKey: string;
  requestId: string;
  toolName: string;
  risk: string;
  decision: "allow" | "ask";
  reason: string;
  by: "rule" | "ai";
  model: string | null;
  at: string;
}

export interface AutoApproveContext {
  projectId: string;
  settings: AutoApproveSettings;
  /** The card's description, when the cwd is a card's worktree. */
  description?: string;
}

export interface AutoApproverOptions {
  db: Database;
  runtime: Pick<AgentRuntime, "judgePermission">;
  dataDir: string;
  context(cwd: string): AutoApproveContext | null;
  /** 10 s when absent. */
  timeoutMs?: number;
  usage?: {
    record(entry: { at: string; model: string; tokens: UsageTokens; projectPath: string }): void;
  };
}

/** Stub. */
export function autoApproveDir(dataDir: string): string {
  return dataDir;
}

/** Stub. */
export function historyExcludes(config: {
  dataDir: string;
  history: { excludeCwds: readonly string[] };
}): string[] {
  return [...config.history.excludeCwds];
}

/** Stub. */
export class AutoApprover {
  constructor(readonly opts: AutoApproverOptions) {}

  async decide(_request: AutoApproveRequest): Promise<AutoDecision | null> {
    return null;
  }

  suspend(_sessionKey: string, _reason: string): void {}

  resume(_sessionKey: string): void {}

  suspended(): Array<{ sessionKey: string; reason: string; at: string }> {
    return [];
  }

  list(
    _filter: { projectId?: string; sessionKey?: string; limit?: number } = {},
  ): AutoApprovalRecord[] {
    return [];
  }
}
