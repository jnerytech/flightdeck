import type { Database } from "bun:sqlite";
import type { CostsDivergence, CostsStatus, UnpricedModel } from "@flightdeck/protocol";
import { costOf, PRICING_DATE, type Pricing } from "./pricing.ts";
import type { UsageTokens } from "./usage-indexer.ts";

export interface CostsOptions {
  db: Database;
  pricing: Pricing;
  /** The table as it is now (the config file read again); `reprice` uses it when present. */
  loadPricing?: () => Pricing;
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

  status(): CostsStatus {
    const unpriced = this.db
      .query<UnpricedModel, []>(
        `SELECT model, COUNT(*) AS entries, SUM(${TOKENS_SQL}) AS tokens FROM usage_entries
         WHERE cost_usd IS NULL GROUP BY model ORDER BY model`,
      )
      .all();
    return { pricingDate: PRICING_DATE, unpriced, divergences: this.divergences() };
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
