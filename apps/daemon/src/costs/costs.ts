import type { Database } from "bun:sqlite";
import type {
  CostsDivergence,
  CostsFilter,
  CostsSession,
  CostsStatus,
  CostsSummary,
  UnpricedModel,
  UsageOrigin,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { costOf, PRICING_DATE, type Pricing } from "./pricing.ts";
import type { InitialLoad, UsageTokens } from "./usage-indexer.ts";

export interface CostsOptions {
  db: Database;
  pricing: Pricing;
  /** The table as it is now (the config file read again); `reprice` uses it when present. */
  loadPricing?: () => Pricing;
  /** Progress of the usage indexer's first pass; divergences wait for it to end. */
  initialLoad?: () => InitialLoad;
}

/** Above both, the computed cost and the SDK's disagree enough to doubt the price table. */
const DIVERGENCE_RATIO = 0.1;
const DIVERGENCE_USD = 0.05;

interface TokenRow {
  message_id: string;
  model: string;
  speed: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
}

const tokensOf = (row: TokenRow): UsageTokens => ({
  model: row.model,
  speed: row.speed,
  input: row.input,
  output: row.output,
  cacheRead: row.cache_read,
  cacheWrite5m: row.cache_write_5m,
  cacheWrite1h: row.cache_write_1h,
});

/** The most expensive sessions `costs.summary` lists. */
const TOP_SESSIONS = 20;

const FILTERS = [
  ["projectKey", "project_key"],
  ["model", "model"],
  ["origin", "origin"],
] as const;

const CSV_COLUMNS = [
  "day",
  "project_key",
  "model",
  "origin",
  "input",
  "output",
  "cache_read",
  "cache_write_5m",
  "cache_write_1h",
  "cost_usd",
] as const;

/** A CSV field, quoted when it holds a comma, a quote or a line break. */
const csvField = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Every token of an entry, as one number. */
export const TOKENS_SQL = "(input + output + cache_read + cache_write_5m + cache_write_1h)";

/** Estimated costs of the host's usage entries (equivalent in API prices). */
export class Costs {
  private readonly db: Database;
  private pricing: Pricing;

  constructor(readonly opts: CostsOptions) {
    this.db = opts.db;
    this.pricing = opts.pricing;
  }

  /** Cost of a message with the table in use. */
  cost(tokens: UsageTokens): number | null {
    return costOf(tokens, this.pricing);
  }

  /** Recomputes every entry with the current table, in one transaction; returns how many. */
  reprice(): { entries: number } {
    this.pricing = this.opts.loadPricing?.() ?? this.pricing;
    const rows = this.db
      .query<TokenRow, []>(
        `SELECT message_id, model, speed, input, output, cache_read, cache_write_5m, cache_write_1h
         FROM usage_entries`,
      )
      .all();
    const update = this.db.query("UPDATE usage_entries SET cost_usd = ? WHERE message_id = ?");
    this.db.transaction(() => {
      for (const row of rows) update.run(this.cost(tokensOf(row)), row.message_id);
    })();
    return { entries: rows.length };
  }

  /** Totals and breakdowns of the entries of `from`..`to` (days, inclusive) that pass the filter. */
  summary(filter: CostsFilter): CostsSummary {
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
        cacheSavingsUsd: this.cacheSavings(sql, params),
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

  /** What the cache reads cost less than the same tokens would as plain input. */
  private cacheSavings(sql: string, params: Record<string, string>): number {
    const rows = this.db
      .query<TokenRow, Record<string, string>>(
        `SELECT message_id, model, speed, input, output, cache_read, cache_write_5m, cache_write_1h
         FROM usage_entries u WHERE ${sql} AND cache_read > 0`,
      )
      .all(params);
    let savings = 0;
    for (const row of rows) {
      const tokens = tokensOf(row);
      const plain = this.cost({ ...tokens, input: tokens.input + tokens.cacheRead, cacheRead: 0 });
      savings += (plain ?? 0) - (this.cost(tokens) ?? 0);
    }
    return savings;
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
    return this.ofManaged(
      `SELECT session_id FROM card_runs WHERE card_id = $id
       UNION SELECT st.session_id FROM step_runs st JOIN workflow_runs w ON w.id = st.run_id
       WHERE w.card_id = $id`,
      cardId,
    );
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

  /** One line per day, project, model and origin. */
  export(filter: CostsFilter): { csv: string; filename: string } {
    const { sql, params } = this.where(filter);
    const rows = this.db
      .query(
        `SELECT day, project_key, model, origin, SUM(input) AS input, SUM(output) AS output,
           SUM(cache_read) AS cache_read, SUM(cache_write_5m) AS cache_write_5m,
           SUM(cache_write_1h) AS cache_write_1h, SUM(cost_usd) AS cost_usd
         FROM usage_entries u WHERE ${sql} GROUP BY day, project_key, model, origin
         ORDER BY day, project_key, model, origin`,
      )
      .all(params) as Array<Record<string, string | number | null>>;
    const lines = [CSV_COLUMNS.join(",")];
    for (const row of rows) {
      const cost = row.cost_usd as number | null;
      const fields = CSV_COLUMNS.slice(0, -1).map((column) => csvField(String(row[column])));
      lines.push([...fields, cost === null ? "" : cost.toFixed(6)].join(","));
    }
    return {
      csv: `${lines.join("\n")}\n`,
      filename: `flightdeck-custos-${filter.from}-a-${filter.to}.csv`,
    };
  }

  /** The SQL condition (over `usage_entries u`) of a filter. */
  private where(filter: CostsFilter): { sql: string; params: Record<string, string> } {
    if (filter.from > filter.to) {
      throw new FlightdeckError("bad_request", `período invertido: ${filter.from} > ${filter.to}`);
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

  status(): CostsStatus {
    const unpriced = this.db
      .query<UnpricedModel, []>(
        `SELECT model, COUNT(*) AS entries, SUM(${TOKENS_SQL}) AS tokens FROM usage_entries
         WHERE cost_usd IS NULL GROUP BY model ORDER BY model`,
      )
      .all();
    const initialLoad = this.opts.initialLoad?.() ?? { state: "done", filesDone: 0, filesTotal: 0 };
    // Halfway through the load a session's cost is partial: no divergence until it ends.
    const divergences = initialLoad.state === "done" ? this.divergences() : [];
    return { initialLoad, pricingDate: PRICING_DATE, unpriced, divergences };
  }

  /**
   * Managed sessions whose computed cost (subagents included) is far from the last
   * `total_cost_usd` the SDK reported for them, Claude Code's own estimate (phase 6).
   */
  private divergences(): CostsDivergence[] {
    const rows = this.db
      .query<{ id: string; computed: number; payload: string | null }, []>(
        `SELECT u.claude_session_id AS id, TOTAL(u.cost_usd) AS computed,
           (SELECT e.payload FROM sessions s JOIN events e ON e.session_id = s.id
            WHERE s.claude_session_id = u.claude_session_id AND e.type = 'turn.result'
            ORDER BY s.updated_at DESC, e.seq DESC LIMIT 1) AS payload
         FROM usage_entries u
         WHERE u.claude_session_id IN (SELECT claude_session_id FROM sessions)
         GROUP BY u.claude_session_id ORDER BY u.claude_session_id`,
      )
      .all();
    const divergences: CostsDivergence[] = [];
    for (const { id, computed, payload } of rows) {
      const sdk = payload ? (JSON.parse(payload).costUsd as number | undefined) : undefined;
      if (sdk === undefined) continue;
      const gap = Math.abs(computed - sdk);
      if (gap <= DIVERGENCE_USD || gap <= sdk * DIVERGENCE_RATIO) continue;
      const { model } = this.db
        .query<{ model: string }, [string]>(
          `SELECT model FROM usage_entries WHERE claude_session_id = ?
           GROUP BY model ORDER BY TOTAL(cost_usd) DESC, model LIMIT 1`,
        )
        .get(id) as { model: string };
      divergences.push({ claudeSessionId: id, model, computedUsd: computed, sdkUsd: sdk });
    }
    return divergences;
  }
}
