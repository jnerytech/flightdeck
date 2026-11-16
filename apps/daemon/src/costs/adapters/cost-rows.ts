import type { Database } from "bun:sqlite";
import type {
  CostsFilter,
  CostsSession,
  CostsSummary,
  UnpricedModel,
  UsageOrigin,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";

/**
 * The SQLite side of the costs (#1589): every question the costs page asks of `usage_entries` and
 * the tables its sessions and cards live in. The `Costs` class decides what a price, a saving or
 * a divergence is; this reads the rows it decides from, and writes the prices it computed.
 */

/** The tokens of one entry, as the table keeps them. */
export interface TokenRow {
  message_id: string;
  model: string;
  speed: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
}

/** A managed session's computed cost and the last payload of its `turn.result` event. */
export interface SessionTurnRow {
  id: string;
  computed: number;
  payload: string | null;
}

/** A session's cost in the OTLP telemetry and the stamp of its first request. */
export interface TelemetrySessionRow {
  id: string;
  telemetry: number;
  first: number;
}

/** The totals and breakdowns of a period; the cache savings need the price table, so they stay out. */
export type SummaryRows = Omit<CostsSummary, "totals"> & {
  totals: Omit<CostsSummary["totals"], "cacheSavingsUsd">;
};

/** The most expensive sessions `costs.summary` lists. */
const TOP_SESSIONS = 20;

const FILTERS = [
  ["projectKey", "project_key"],
  ["model", "model"],
  ["origin", "origin"],
] as const;

/** Every token of an entry, as one number. */
const TOKENS_SQL = "(input + output + cache_read + cache_write_5m + cache_write_1h)";

/**
 * The persona a usage entry belongs to: the one its session was opened with, else the one applied
 * to it later (an applied persona does not split a session's cost); a terminal session by its
 * badge. No owner or no persona is `NULL`.
 */
const PERSONA_SQL = `COALESCE(
  (SELECT json_extract(s.persona, '$.id') FROM sessions s
    WHERE s.claude_session_id = u.claude_session_id AND s.persona IS NOT NULL
    ORDER BY s.updated_at DESC LIMIT 1),
  (SELECT json_extract(s.applied_persona, '$.id') FROM sessions s
    WHERE s.claude_session_id = u.claude_session_id AND s.applied_persona IS NOT NULL
    ORDER BY s.updated_at DESC LIMIT 1),
  (SELECT json_extract(COALESCE(e.persona_open, e.persona_applied), '$.id') FROM external_sessions e
    WHERE e.claude_session_id = u.claude_session_id))`;

export class CostRows {
  constructor(private readonly db: Database) {}

  /** The tokens of every entry. */
  tokenRows(): TokenRow[] {
    return this.db
      .query<TokenRow, []>(
        `SELECT message_id, model, speed, input, output, cache_read, cache_write_5m, cache_write_1h
         FROM usage_entries`,
      )
      .all();
  }

  /** Stores a price for each entry, in one transaction. */
  saveCosts(prices: ReadonlyArray<{ messageId: string; costUsd: number | null }>): void {
    const update = this.db.query("UPDATE usage_entries SET cost_usd = ? WHERE message_id = ?");
    this.db.transaction(() => {
      for (const { messageId, costUsd } of prices) update.run(costUsd, messageId);
    })();
  }

  /** Totals and breakdowns of the entries of `from`..`to` (days, inclusive) that pass the filter. */
  summary(filter: CostsFilter): SummaryRows {
    const { sql, params } = this.where(filter);
    const totals = this.db
      .query(
        `SELECT TOTAL(cost_usd) AS cost, COALESCE(SUM(input), 0) AS input,
           COALESCE(SUM(output), 0) AS output, COALESCE(SUM(cache_read), 0) AS cacheRead,
           COALESCE(SUM(cache_write_5m), 0) AS cacheWrite5m,
           COALESCE(SUM(cache_write_1h), 0) AS cacheWrite1h, COUNT(*) AS messages,
           COALESCE(SUM(cost_usd IS NULL), 0) AS unpriced
         FROM usage_entries u WHERE ${sql}`,
      )
      .get(params) as Record<string, number>;
    /** Cost and tokens by `columns`; the days in order, anything else most expensive first. */
    const grouped = (columns: string, order: string) =>
      this.db
        .query(
          `SELECT ${columns}, TOTAL(cost_usd) AS costUsd, SUM(${TOKENS_SQL}) AS tokens,
             COUNT(cost_usd) > 0 AS priced
           FROM usage_entries u WHERE ${sql} GROUP BY ${columns} ORDER BY ${order}`,
        )
        .all(params) as Array<Record<string, string | number>>;
    const byCost = (column: string) => grouped(column, `costUsd DESC, ${column}`);
    return {
      from: filter.from,
      to: filter.to,
      totals: {
        costUsd: totals.cost as number,
        tokens: {
          input: totals.input as number,
          output: totals.output as number,
          cacheRead: totals.cacheRead as number,
          cacheWrite5m: totals.cacheWrite5m as number,
          cacheWrite1h: totals.cacheWrite1h as number,
        },
        messages: totals.messages as number,
        unpricedMessages: totals.unpriced as number,
      },
      byDay: grouped("day, project_key", "day, project_key").map((r) => ({
        day: r.day as string,
        projectKey: r.project_key as string,
        costUsd: r.costUsd as number,
        tokens: r.tokens as number,
      })),
      byProject: byCost("project_key").map((r) => ({
        projectKey: r.project_key as string,
        costUsd: r.costUsd as number,
        tokens: r.tokens as number,
      })),
      byModel: byCost("model").map((r) => ({
        model: r.model as string,
        costUsd: r.costUsd as number,
        tokens: r.tokens as number,
        priced: r.priced === 1,
      })),
      byOrigin: byCost("origin").map((r) => ({
        origin: r.origin as UsageOrigin,
        costUsd: r.costUsd as number,
        tokens: r.tokens as number,
      })),
      byPersona: this.db
        .query(
          `SELECT ${PERSONA_SQL} AS persona, TOTAL(cost_usd) AS costUsd, SUM(${TOKENS_SQL}) AS tokens
           FROM usage_entries u WHERE ${sql} GROUP BY persona ORDER BY costUsd DESC, persona`,
        )
        .all(params) as CostsSummary["byPersona"],
      topSessions: this.db
        .query(
          `SELECT u.claude_session_id AS claudeSessionId,
             (SELECT s.id FROM sessions s WHERE s.claude_session_id = u.claude_session_id
              ORDER BY s.updated_at DESC LIMIT 1) AS sessionId,
             MIN(u.project_key) AS projectKey,
             COALESCE((SELECT m.name FROM session_meta m
                       WHERE m.claude_session_id = u.claude_session_id), h.title) AS title,
             COALESCE(h.cwd, (SELECT s.cwd FROM sessions s
                              WHERE s.claude_session_id = u.claude_session_id
                              ORDER BY s.updated_at DESC LIMIT 1)) AS cwd,
             TOTAL(u.cost_usd) AS costUsd, SUM(${TOKENS_SQL}) AS tokens
           FROM usage_entries u
           LEFT JOIN history_sessions h ON h.claude_session_id = u.claude_session_id
           WHERE ${sql} GROUP BY u.claude_session_id ORDER BY costUsd DESC, u.claude_session_id
           LIMIT ${TOP_SESSIONS}`,
        )
        .all(params) as CostsSummary["topSessions"],
    };
  }

  /** The entries of a period that read from the cache. */
  cacheReadRows(filter: CostsFilter): TokenRow[] {
    const { sql, params } = this.where(filter);
    return this.db
      .query<TokenRow, Record<string, string>>(
        `SELECT message_id, model, speed, input, output, cache_read, cache_write_5m, cache_write_1h
         FROM usage_entries u WHERE ${sql} AND cache_read > 0`,
      )
      .all(params);
  }

  /** One session, its subagents included. */
  session(claudeSessionId: string): CostsSession {
    const totals = this.db
      .query(
        `SELECT TOTAL(cost_usd) AS cost, COALESCE(SUM(${TOKENS_SQL}), 0) AS tokens,
           TOTAL(CASE WHEN origin = 'subagent' THEN cost_usd END) AS subagent
         FROM usage_entries WHERE claude_session_id = ?`,
      )
      .get(claudeSessionId) as { cost: number; tokens: number; subagent: number };
    const byModel = this.db
      .query(
        `SELECT model, TOTAL(cost_usd) AS costUsd, SUM(${TOKENS_SQL}) AS tokens FROM usage_entries
         WHERE claude_session_id = ? GROUP BY model ORDER BY costUsd DESC, model`,
      )
      .all(claudeSessionId) as CostsSession["byModel"];
    return {
      claudeSessionId,
      costUsd: totals.cost,
      tokens: totals.tokens,
      subagentCostUsd: totals.subagent,
      byModel,
    };
  }

  /** Cost of each of these sessions that has entries. */
  sessions(claudeSessionIds: readonly string[]): Record<string, number> {
    const rows = this.db
      .query<{ id: string; cost: number }, [string]>(
        `SELECT claude_session_id AS id, TOTAL(cost_usd) AS cost FROM usage_entries
         WHERE claude_session_id IN (SELECT value FROM json_each(?)) GROUP BY claude_session_id`,
      )
      .all(JSON.stringify(claudeSessionIds));
    return Object.fromEntries(rows.map((r) => [r.id, r.cost]));
  }

  /** Every session a card ran (its runs and their workflow steps). */
  card(cardId: string): number {
    const sessions = this.ofManaged(
      `SELECT session_id FROM card_runs WHERE card_id = $id
       UNION SELECT st.session_id FROM step_runs st JOIN workflow_runs w ON w.id = st.run_id
       WHERE w.card_id = $id`,
      cardId,
    );
    // Issue #1439: a second-opinion review has no session; its usage is recorded under the card.
    const reviews = this.db
      .query(
        "SELECT TOTAL(cost_usd) AS cost FROM usage_entries WHERE substr(message_id, 1, length($prefix)) = $prefix",
      )
      .get({ prefix: `card-review-${cardId}-` }) as { cost: number };
    return sessions + reviews.cost;
  }

  /** The sessions of one run of a card (the run itself and its workflow steps). */
  run(runId: string): number {
    return this.ofManaged(
      `SELECT session_id FROM card_runs WHERE id = $id
       UNION SELECT session_id FROM step_runs WHERE run_id = $id`,
      runId,
    );
  }

  /** Cost of the managed sessions (by their own id) that `sessionsSql` selects. */
  private ofManaged(sessionsSql: string, id: string): number {
    const row = this.db
      .query(
        `SELECT TOTAL(cost_usd) AS cost FROM usage_entries WHERE claude_session_id IN
           (SELECT claude_session_id FROM sessions WHERE id IN (${sessionsSql}))`,
      )
      .get({ id }) as { cost: number };
    return row.cost;
  }

  /** One row per day, project, model and origin. */
  exportRows(filter: CostsFilter): Array<Record<string, string | number | null>> {
    const { sql, params } = this.where(filter);
    return this.db
      .query(
        `SELECT day, project_key, model, origin, SUM(input) AS input, SUM(output) AS output,
           SUM(cache_read) AS cache_read, SUM(cache_write_5m) AS cache_write_5m,
           SUM(cache_write_1h) AS cache_write_1h, SUM(cost_usd) AS cost_usd
         FROM usage_entries u WHERE ${sql} GROUP BY day, project_key, model, origin
         ORDER BY day, project_key, model, origin`,
      )
      .all(params) as Array<Record<string, string | number | null>>;
  }

  /** The SQL condition (over `usage_entries u`) of a filter. */
  private where(filter: CostsFilter): { sql: string; params: Record<string, string> } {
    if (filter.from > filter.to) {
      throw new FlightdeckError(
        "bad_request",
        `inverted period: ${filter.from} > ${filter.to}`,
        "period_inverted",
        { from: filter.from, to: filter.to },
      );
    }
    const parts = ["u.day BETWEEN $from AND $to"];
    const params: Record<string, string> = { from: filter.from, to: filter.to };
    for (const [key, column] of FILTERS) {
      const value = filter[key];
      if (value === undefined) continue;
      parts.push(`u.${column} = $${key}`);
      params[key] = value;
    }
    return { sql: parts.join(" AND "), params };
  }

  /** The models with entries that have no price, with how many and their tokens. */
  unpriced(): UnpricedModel[] {
    return this.db
      .query<UnpricedModel, []>(
        `SELECT model, COUNT(*) AS entries, SUM(${TOKENS_SQL}) AS tokens FROM usage_entries
         WHERE cost_usd IS NULL GROUP BY model ORDER BY model`,
      )
      .all();
  }

  /** Managed sessions with their computed cost and the last `turn.result` payload they reported. */
  sessionTurns(): SessionTurnRow[] {
    return this.db
      .query<SessionTurnRow, []>(
        `SELECT u.claude_session_id AS id, TOTAL(u.cost_usd) AS computed,
           (SELECT e.payload FROM sessions s JOIN events e ON e.session_id = s.id
            WHERE s.claude_session_id = u.claude_session_id AND e.type = 'turn.result'
            ORDER BY s.updated_at DESC, e.seq DESC LIMIT 1) AS payload
         FROM usage_entries u
         WHERE u.claude_session_id IN (SELECT claude_session_id FROM sessions)
         GROUP BY u.claude_session_id ORDER BY u.claude_session_id`,
      )
      .all();
  }

  /** The model that cost a session the most. */
  topModel(claudeSessionId: string): string {
    const { model } = this.db
      .query<{ model: string }, [string]>(
        `SELECT model FROM usage_entries WHERE claude_session_id = ?
         GROUP BY model ORDER BY TOTAL(cost_usd) DESC, model LIMIT 1`,
      )
      .get(claudeSessionId) as { model: string };
    return model;
  }

  /** Sessions with priced `api_request` telemetry: its cost and the stamp of its first request. */
  telemetrySessions(): TelemetrySessionRow[] {
    return this.db
      .query<TelemetrySessionRow, []>(
        `SELECT claude_session_id AS id, TOTAL(cost_usd) AS telemetry, MIN(at) AS first
         FROM telemetry_events WHERE name = 'api_request' AND cost_usd IS NOT NULL
         GROUP BY claude_session_id ORDER BY claude_session_id`,
      )
      .all();
  }

  /** What the transcripts say a session cost from `since` on (an ISO stamp). */
  computedSince(claudeSessionId: string, since: string): number {
    const row = this.db
      .query<{ computed: number }, [string, string]>(
        "SELECT TOTAL(cost_usd) AS computed FROM usage_entries WHERE claude_session_id = ? AND at >= ?",
      )
      .get(claudeSessionId, since) as { computed: number };
    return row.computed;
  }
}
