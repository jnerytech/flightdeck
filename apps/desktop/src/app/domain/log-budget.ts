/**
 * How much one log source may write (issue #259, #1601): a token bucket refilled from a clock the
 * caller gives, so nothing here reads one. The app log keeps the buckets and the lines.
 */

/** A source may log this many lines at once (issue #259)... */
export const LOG_BURST = 50;
/** ...and gets this many more each second, up to the burst. */
const LOG_PER_SECOND = 10;

/** One source's budget: a token bucket refilled from the clock. */
export interface Budget {
  tokens: number;
  at: number;
  dropped: number;
}

/** The source's budget with one line taken from it, or null (and counted) when it has none. */
export function spend(budgets: Map<string, Budget>, source: string, at: number): Budget | null {
  const budget = budgets.get(source) ?? { tokens: LOG_BURST, at, dropped: 0 };
  budgets.set(source, budget);
  budget.tokens = Math.min(LOG_BURST, budget.tokens + ((at - budget.at) / 1000) * LOG_PER_SECOND);
  budget.at = at;
  if (budget.tokens < 1) {
    budget.dropped++;
    return null;
  }
  budget.tokens--;
  return budget;
}
