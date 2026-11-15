import type { Database } from "bun:sqlite";
import type {
  CostsDivergence,
  CostsFilter,
  CostsSession,
  CostsStatus,
  CostsSummary,
  TelemetryDivergence,
} from "@flightdeck/protocol";
import { z } from "zod";
import type { UsageTokens } from "../kernel/index.ts";
import { parseJsonOr } from "../kernel/index.ts";
import { CostRows, type TokenRow } from "./adapters/cost-rows.ts";
import { costOf, PRICING_DATE, type Pricing } from "./domain/pricing.ts";
import type { InitialLoad } from "./usage-indexer.ts";

export interface CostsOptions {
  db: Database;
  pricing: Pricing;
  /** The table as it is now (the config file read again); `reprice` uses it when present. */
  loadPricing?: () => Pricing | Promise<Pricing>;
  /** Progress of the usage indexer's first pass; divergences wait for it to end. */
  initialLoad?: () => InitialLoad;
}

/** Above both, the computed cost and the SDK's disagree enough to doubt the price table. */
const DIVERGENCE_RATIO = 0.1;
const DIVERGENCE_USD = 0.05;
/** A message is stamped a little before the API request that paid for it ends. */
const TELEMETRY_SLACK_MS = 60_000;

/** The SDK's running total in a `turn.result` payload; a damaged payload says nothing. */
const TurnCost = z.looseObject({ costUsd: z.number().optional().catch(undefined) });

const farApart = (computed: number, reported: number) => {
  const gap = Math.abs(computed - reported);
  return gap > DIVERGENCE_USD && gap > reported * DIVERGENCE_RATIO;
};

const tokensOf = (row: TokenRow): UsageTokens => ({
  model: row.model,
  speed: row.speed,
  input: row.input,
  output: row.output,
  cacheRead: row.cache_read,
  cacheWrite5m: row.cache_write_5m,
  cacheWrite1h: row.cache_write_1h,
});

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

/** Estimated costs of the host's usage entries (equivalent in API prices). */
export class Costs {
  private readonly rows: CostRows;
  private pricing: Pricing;

  constructor(readonly opts: CostsOptions) {
    this.rows = new CostRows(opts.db);
    this.pricing = opts.pricing;
  }

  /** Cost of a message with the table in use. */
  cost(tokens: UsageTokens): number | null {
    return costOf(tokens, this.pricing);
  }

  /** Recomputes every entry with the current table, in one transaction; returns how many. */
  async reprice(): Promise<{ entries: number }> {
    this.pricing = (await this.opts.loadPricing?.()) ?? this.pricing;
    const rows = this.rows.tokenRows();
    this.rows.saveCosts(
      rows.map((row) => ({ messageId: row.message_id, costUsd: this.cost(tokensOf(row)) })),
    );
    return { entries: rows.length };
  }

  /** Totals and breakdowns of the entries of `from`..`to` (days, inclusive) that pass the filter. */
  summary(filter: CostsFilter): CostsSummary {
    const rows = this.rows.summary(filter);
    const { totals } = rows;
    return {
      ...rows,
      totals: {
        costUsd: totals.costUsd,
        tokens: totals.tokens,
        cacheSavingsUsd: this.cacheSavings(filter),
        messages: totals.messages,
        unpricedMessages: totals.unpricedMessages,
      },
    };
  }

  /** What the cache reads cost less than the same tokens would as plain input. */
  private cacheSavings(filter: CostsFilter): number {
    let savings = 0;
    for (const row of this.rows.cacheReadRows(filter)) {
      const tokens = tokensOf(row);
      const plain = this.cost({ ...tokens, input: tokens.input + tokens.cacheRead, cacheRead: 0 });
      savings += (plain ?? 0) - (this.cost(tokens) ?? 0);
    }
    return savings;
  }

  /** One session, its subagents included. */
  session(claudeSessionId: string): CostsSession {
    return this.rows.session(claudeSessionId);
  }

  /** Cost of each of these sessions that has entries. */
  sessions(claudeSessionIds: readonly string[]): Record<string, number> {
    return this.rows.sessions(claudeSessionIds);
  }

  /** Every session a card ran (its runs and their workflow steps). */
  card(cardId: string): number {
    return this.rows.card(cardId);
  }

  /** The sessions of one run of a card (the run itself and its workflow steps). */
  run(runId: string): number {
    return this.rows.run(runId);
  }

  /** One line per day, project, model and origin. */
  export(filter: CostsFilter): { csv: string; filename: string } {
    const lines = [CSV_COLUMNS.join(",")];
    for (const row of this.rows.exportRows(filter)) {
      const cost = row.cost_usd as number | null;
      const fields = CSV_COLUMNS.slice(0, -1).map((column) => csvField(String(row[column])));
      lines.push([...fields, cost === null ? "" : cost.toFixed(6)].join(","));
    }
    return {
      csv: `${lines.join("\n")}\n`,
      filename: `flightdeck-custos-${filter.from}-a-${filter.to}.csv`,
    };
  }

  status(): CostsStatus {
    const unpriced = this.rows.unpriced();
    const initialLoad = this.opts.initialLoad?.() ?? { state: "done", filesDone: 0, filesTotal: 0 };
    // Halfway through the load a session's cost is partial: no divergence until it ends.
    const divergences = initialLoad.state === "done" ? this.divergences() : [];
    return {
      initialLoad,
      pricingDate: PRICING_DATE,
      unpriced,
      divergences,
      telemetryDivergences: initialLoad.state === "done" ? this.telemetryDivergences() : [],
    };
  }

  /**
   * Managed sessions whose computed cost (subagents included) is far from the last
   * `total_cost_usd` the SDK reported for them, Claude Code's own estimate (phase 6).
   */
  private divergences(): CostsDivergence[] {
    const divergences: CostsDivergence[] = [];
    for (const { id, computed, payload } of this.rows.sessionTurns()) {
      const sdk = payload ? parseJsonOr(TurnCost, payload, {}).costUsd : undefined;
      if (sdk === undefined) continue;
      if (!farApart(computed, sdk)) continue;
      const model = this.rows.topModel(id);
      divergences.push({ claudeSessionId: id, model, computedUsd: computed, sdkUsd: sdk });
    }
    return divergences;
  }

  /**
   * Sessions whose cost in the OTLP telemetry is far from the transcripts' for the stretch the
   * exporter was on (the transcripts before its first request are not compared).
   */
  private telemetryDivergences(): TelemetryDivergence[] {
    const divergences: TelemetryDivergence[] = [];
    for (const { id, telemetry, first } of this.rows.telemetrySessions()) {
      const since = new Date(first - TELEMETRY_SLACK_MS).toISOString();
      const computed = this.rows.computedSince(id, since);
      if (farApart(computed, telemetry)) {
        divergences.push({ claudeSessionId: id, computedUsd: computed, telemetryUsd: telemetry });
      }
    }
    return divergences;
  }
}
