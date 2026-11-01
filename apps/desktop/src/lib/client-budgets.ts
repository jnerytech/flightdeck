/** Where the thresholds already announced are kept, so a restart announces none twice. */
export const CLIENT_BUDGET_ALERTS_KEY = "flightdeck.clientBudgetAlerts";

/** An alert fires once per month at each of these fractions of the limit, like a host's budget. */
export const CLIENT_BUDGET_THRESHOLDS = [0.5, 0.8, 1] as const;

/** A client's month limit against what it has spent so far. */
export interface ClientBudgetState {
  clientId: string;
  limitUsd: number;
  spentUsd: number;
  fraction: number;
  /** The thresholds the spend has reached this month. */
  crossed: number[];
}

/** The thresholds announced, by `clientId|YYYY-MM`. */
export type AnnouncedThresholds = Record<string, number[]>;

export interface Evaluation {
  states: ClientBudgetState[];
  /** The thresholds crossed now that were not announced before: each makes news once. */
  news: Array<{ clientId: string; threshold: number }>;
  announced: AnnouncedThresholds;
}

/** The state of each client's budget this month, and which thresholds are news. */
export function evaluateClientBudgets(args: {
  month: string;
  limits: Record<string, number>;
  spent: Record<string, number>;
  announced: AnnouncedThresholds;
}): Evaluation {
  const { month, limits, spent, announced } = args;
  const states = Object.entries(limits).map(([clientId, limitUsd]): ClientBudgetState => {
    const spentUsd = spent[clientId] ?? 0;
    const fraction = spentUsd / limitUsd;
    return {
      clientId,
      limitUsd,
      spentUsd,
      fraction,
      crossed: CLIENT_BUDGET_THRESHOLDS.filter((threshold) => fraction >= threshold),
    };
  });
  const news: Evaluation["news"] = [];
  const next: AnnouncedThresholds = {};
  for (const state of states) {
    const key = `${state.clientId}|${month}`;
    const seen = announced[key] ?? [];
    for (const threshold of state.crossed) {
      if (!seen.includes(threshold)) news.push({ clientId: state.clientId, threshold });
    }
    if (state.crossed.length > 0) next[key] = state.crossed;
  }
  return { states, news, announced: next };
}
