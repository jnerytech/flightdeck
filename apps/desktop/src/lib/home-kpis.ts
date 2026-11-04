import type { Budget, CostsSummary, UsageSummary } from "@flightdeck/protocol";

/** What Home reads: the last days of every host, and the budgets that are set. */
export interface HomeInput {
  /** `YYYY-MM-DD`, oldest first: the days the sparklines draw. */
  days: string[];
  /** One costs summary per host. */
  costs: CostsSummary[];
  /** One usage summary per host. */
  usage: UsageSummary[];
  budgets: Budget[];
}

export interface HomeKpis {
  spend: {
    totalUsd: number;
    series: number[];
    /** The month's host budgets together; `null` when none is set. */
    budget: { spentUsd: number; limitUsd: number } | null;
  };
  turns: {
    total: number;
    ok: number;
    /** `null` when a host does not count them (an older daemon). */
    failed: number | null;
    series: number[];
  };
  tokens: { total: number; cacheRead: number; series: number[] };
  average: {
    costPerTurnUsd: number | null;
    turnMs: number | null;
    successRate: number | null;
    series: number[];
  };
}

export function homeKpis(input: HomeInput): HomeKpis {
  const zeros = input.days.map(() => 0);
  return {
    spend: { totalUsd: 0, series: zeros, budget: null },
    turns: { total: 0, ok: 0, failed: null, series: zeros },
    tokens: { total: 0, cacheRead: 0, series: zeros },
    average: { costPerTurnUsd: null, turnMs: null, successRate: null, series: zeros },
  };
}
