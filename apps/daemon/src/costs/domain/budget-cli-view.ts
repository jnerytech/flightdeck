/** Issue #3460: what `flightdeckd budget` takes and says, as pure rules over the daemon's answers. */
import type { Budget } from "@flightdeck/protocol";

export interface BudgetCliArgs {
  action: "list" | "set" | "set-quota" | "remove";
  /** `remove`: the budget to drop; `set` and `set-quota`: the budget to change (a new one when absent). */
  id?: string;
  scope?: "host" | "project";
  projectKey?: string;
  /** `set`: the period of a dollar limit. */
  period?: "day" | "month";
  /** `set-quota`: the quota window a share limit is about. */
  window?: "five_hour" | "seven_day";
  limitUsd?: number;
  /** `set-quota`: the share of the window, from 0.001 to 1. */
  limitPct?: number;
  /** What happens at the limit: say so (`notify`) or hold new cards (`queue`). */
  budgetAction?: "notify" | "queue";
  json?: boolean;
}

/** What a write that got no answer may have done, as the text that follows the message. */
export const UNSURE_BUDGET = "";

/** One budget as a line. */
export const budgetLine = (_budget: Budget): string => "";

/** One line per budget, or a sentence when there is none. */
export const budgetLines = (_budgets: Budget[]): string[] => [];
