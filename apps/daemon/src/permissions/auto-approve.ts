/**
 * Phase 13: the optional automatic approval of a project. High risk and the network always go to
 * you; low can pass without AI; medium asks a short isolated query, which can only approve or
 * hand the request to you (a "no" from it is a question, never a denial). A session that got
 * third-party content is suspended until you resume it. Every decision is recorded.
 */
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { summarizeInput } from "../central/external-permissions.ts";
import type { UsageTokens } from "../costs/usage-indexer.ts";
import type { AgentRuntime } from "../runtime/types.ts";
import { ulid } from "../ulid.ts";
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
  /** The card, when the cwd is its worktree: `card:<id>` can suspend its sessions. */
  cardId?: string;
}

export interface AutoApproverOptions {
  db: Database;
  runtime: Pick<AgentRuntime, "judgePermission">;
  dataDir: string;
  /** The project (and card) of a cwd; null outside the projects. */
  context(cwd: string): AutoApproveContext | null;
  /** 10 s when absent. */
  timeoutMs?: number;
  /** The costs (phase 8): each query's usage, with origin `auto-approve`. */
  usage?: {
    record(entry: { at: string; model: string; tokens: UsageTokens; projectPath: string }): void;
  };
}

/** The folder the AI's queries run in: excluded from the history, so they never show up. */
export function autoApproveDir(dataDir: string): string {
  return join(dataDir, "auto-approve");
}

/** The history's excluded folders, with the automatic approval's. */
export function historyExcludes(config: {
  dataDir: string;
  history: { excludeCwds: readonly string[] };
}): string[] {
  return [...config.history.excludeCwds, autoApproveDir(config.dataDir)];
}

const POLICY =
  "Aprove só se for claramente seguro e dentro do pedido; na dúvida, ask. " +
  'Responda com decision ("allow" ou "ask") e reason.';

interface Row {
  id: string;
  project_id: string;
  session_key: string;
  request_id: string;
  tool_name: string;
  risk: string;
  decision: "allow" | "ask";
  reason: string;
  decided_by: "rule" | "ai";
  model: string | null;
  at: string;
}

const toRecord = (row: Row): AutoApprovalRecord => ({
  id: row.id,
  projectId: row.project_id,
  sessionKey: row.session_key,
  requestId: row.request_id,
  toolName: row.tool_name,
  risk: row.risk,
  decision: row.decision,
  reason: row.reason,
  by: row.decided_by,
  model: row.model,
  at: row.at,
});

export class AutoApprover {
  constructor(private readonly opts: AutoApproverOptions) {}

  /** The decision for a request; null when the project has no automatic approval. */
  async decide(request: AutoApproveRequest): Promise<AutoDecision | null> {
    const context = this.opts.context(request.cwd);
    if (!context?.settings.enabled) return null;
    const decision = await this.judge(request, context);
    this.opts.db
      .query(
        `INSERT INTO auto_approvals (id, project_id, session_key, request_id, tool_name, risk,
           decision, reason, decided_by, model, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        context.projectId,
        request.sessionKey,
        request.requestId,
        request.toolName,
        request.risk.level,
        decision.decision,
        decision.reason,
        decision.by,
        decision.model,
        new Date().toISOString(),
      );
    return decision;
  }

  /** Third-party content reached the session: nothing is automatic there until `resume`. */
  suspend(sessionKey: string, reason: string): void {
    this.opts.db
      .query(
        "INSERT OR REPLACE INTO auto_approve_suspended (session_key, reason, at) VALUES (?, ?, ?)",
      )
      .run(sessionKey, reason, new Date().toISOString());
  }

  resume(sessionKey: string): void {
    this.opts.db.query("DELETE FROM auto_approve_suspended WHERE session_key = ?").run(sessionKey);
  }

  suspended(): Array<{ sessionKey: string; reason: string; at: string }> {
    return this.opts.db
      .query<{ session_key: string; reason: string; at: string }, []>(
        "SELECT * FROM auto_approve_suspended ORDER BY at",
      )
      .all()
      .map((row) => ({ sessionKey: row.session_key, reason: row.reason, at: row.at }));
  }

  /** The newest decisions first. */
  list(
    filter: { projectId?: string; sessionKey?: string; limit?: number } = {},
  ): AutoApprovalRecord[] {
    return this.opts.db
      .query<Row, [string | null, string | null, number]>(
        `SELECT * FROM auto_approvals
         WHERE (?1 IS NULL OR project_id = ?1) AND (?2 IS NULL OR session_key = ?2)
         ORDER BY at DESC, rowid DESC LIMIT ?3`,
      )
      .all(filter.projectId ?? null, filter.sessionKey ?? null, filter.limit ?? 200)
      .map(toRecord);
  }

  private async judge(
    request: AutoApproveRequest,
    context: AutoApproveContext,
  ): Promise<AutoDecision> {
    const rule = (decision: "allow" | "ask", reason: string): AutoDecision => ({
      decision,
      reason,
      by: "rule",
      model: null,
    });
    const suspended = this.suspended().find((s) => s.sessionKey === request.sessionKey);
    if (suspended) return rule("ask", `aprovação automática suspensa: ${suspended.reason}`);
    if (request.risk.level === "high") return rule("ask", "risco alto nunca é automático");
    if (request.risk.network) return rule("ask", "acesso à rede nunca é automático");
    if (request.risk.level === "low" && context.settings.lowWithoutAi) {
      return rule("allow", "risco baixo, sem IA");
    }
    const { model } = context.settings;
    const ai = (decision: "allow" | "ask", reason: string): AutoDecision => ({
      decision,
      reason,
      by: "ai",
      model,
    });
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((done) => {
      timer = setTimeout(() => done(null), timeoutMs);
    });
    try {
      const answer = await Promise.race([
        (this.opts.runtime.judgePermission as NonNullable<AgentRuntime["judgePermission"]>)({
          model,
          prompt: this.prompt(request, context),
          cwd: autoApproveDir(this.opts.dataDir),
          signal: controller.signal,
        }),
        late,
      ]);
      if (!answer) {
        controller.abort();
        return ai("ask", `a IA não respondeu em ${timeoutMs / 1000} s`);
      }
      if (answer.tokens) {
        this.opts.usage?.record({
          at: new Date().toISOString(),
          model: answer.tokens.model,
          tokens: answer.tokens,
          projectPath: request.cwd,
        });
      }
      // The AI never denies: anything but "allow" is a question for you.
      return answer.decision === "allow"
        ? ai("allow", answer.reason)
        : ai("ask", `IA: ${answer.reason}`);
    } catch (error) {
      return ai("ask", `erro da IA: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private prompt(request: AutoApproveRequest, context: AutoApproveContext): string {
    return [
      "Um agente de código pede permissão para usar uma ferramenta.",
      `ferramenta: ${request.toolName}`,
      `entrada: ${JSON.stringify(summarizeInput(request.input))}`,
      `cwd: ${request.cwd}`,
      `risco: ${request.risk.level} (${request.risk.reason})`,
      ...(context.description ? [`pedido do card: ${context.description.slice(0, 1000)}`] : []),
      POLICY,
    ].join("\n");
  }
}
