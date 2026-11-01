/**
 * Phase 19: the audit of the decisions about the use of a secret. One row per request, with the
 * rule that decided, the decision, who let it through and how it ended. It never holds a value,
 * only names and reasons, and the limits of the rules count the rows that let a use through.
 */
import type { Database } from "bun:sqlite";
import type {
  VaultDecisionInfo,
  VaultOutcome,
  VaultReportRow,
  VaultRequester,
} from "@flightdeck/protocol";

const DAY_MS = 24 * 3_600_000;

export interface DecisionRow {
  id: string;
  atMs: number;
  secretId: string;
  requester: VaultRequester;
  purpose: VaultDecisionInfo["purpose"];
  action: string | null;
  host: string;
  project: string | null;
  session: string | null;
  ruleId: string | null;
  decision: VaultDecisionInfo["decision"];
  outcome: VaultOutcome;
  approver: VaultDecisionInfo["approver"];
  window: string | null;
  reason: string;
}

interface Stored {
  id: string;
  at: string;
  secret_id: string;
  requester: VaultRequester;
  purpose: VaultDecisionInfo["purpose"];
  action: string | null;
  host: string;
  project: string | null;
  session: string | null;
  rule_id: string | null;
  decision: VaultDecisionInfo["decision"];
  outcome: VaultOutcome;
  approver: VaultDecisionInfo["approver"];
  window: string | null;
  reason: string;
}

export class Decisions {
  constructor(private readonly db: Database) {}

  insert(row: DecisionRow): void {
    this.db
      .query(
        `INSERT INTO vault_decisions
           (id, at, at_ms, secret_id, requester, purpose, action, host, project, session,
            rule_id, decision, outcome, approver, window, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        new Date(row.atMs).toISOString(),
        row.atMs,
        row.secretId,
        row.requester,
        row.purpose,
        row.action,
        row.host,
        row.project,
        row.session,
        row.ruleId,
        row.decision,
        row.outcome,
        row.approver,
        row.window,
        row.reason,
      );
  }

  /** How the request ended, and who let it through. */
  finish(id: string, outcome: VaultOutcome, approver: VaultDecisionInfo["approver"]): void {
    this.db
      .query("UPDATE vault_decisions SET outcome = ?, approver = ? WHERE id = ?")
      .run(outcome, approver, id);
  }

  /** Whether this requester has never asked for this secret before. */
  isNew(secretId: string, requester: VaultRequester): boolean {
    const seen = this.db
      .query("SELECT 1 FROM vault_decisions WHERE secret_id = ? AND requester = ? LIMIT 1")
      .get(secretId, requester);
    return seen === null;
  }

  /** The uses a rule let through since an instant (what its limits count). */
  uses(ruleId: string, sinceMs: number): number {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS n FROM vault_decisions
         WHERE rule_id = ? AND at_ms >= ? AND outcome IN ('allowed', 'approved')`,
      )
      .get(ruleId, sinceMs) as { n: number };
    return row.n;
  }

  list(
    filter: {
      secretId?: string;
      days?: number;
      limit?: number;
    },
    nowMs: number,
  ): VaultDecisionInfo[] {
    const since = nowMs - (filter.days ?? 30) * DAY_MS;
    const rows = this.db
      .query(
        `SELECT * FROM vault_decisions
         WHERE at_ms >= ?1 AND (?2 IS NULL OR secret_id = ?2)
         ORDER BY at_ms DESC, rowid DESC LIMIT ?3`,
      )
      .all(since, filter.secretId ?? null, filter.limit ?? 200) as Stored[];
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      secretId: row.secret_id,
      requester: row.requester,
      purpose: row.purpose,
      action: row.action,
      host: row.host,
      project: row.project,
      session: row.session,
      ruleId: row.rule_id,
      decision: row.decision,
      outcome: row.outcome,
      approver: row.approver,
      window: row.window,
      reason: row.reason,
    }));
  }

  /** The uses by secret, requester and outcome in the last `days` days. */
  report(days: number, nowMs: number): VaultReportRow[] {
    return this.db
      .query(
        `SELECT secret_id AS secretId, requester, outcome, COUNT(*) AS count
         FROM vault_decisions WHERE at_ms >= ?
         GROUP BY secret_id, requester, outcome
         ORDER BY secret_id, requester, outcome`,
      )
      .all(nowMs - days * DAY_MS) as VaultReportRow[];
  }
}
