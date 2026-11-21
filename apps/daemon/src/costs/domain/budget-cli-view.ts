/** Issue #3460: what `flightdeckd budget` takes and says, as pure rules over the daemon's answers. */
import type { Budget } from "@flightdeck/protocol";

export interface BudgetCliArgs {
  action: "list" | "set" | "set-quota" | "remove" | "watch";
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
export const UNSURE_BUDGET =
  "; the budget may or may not have changed: check with `budget list` before trying again";

/** A share as a percentage, with decimals only when it has them (`0.001` is `0.1%`, `0.0015` is `0.15%`, `0.2` is `20%`). */
const percent = (share: number): string => `${Number((share * 100).toFixed(2))}%`;

const dollars = (usd: number): string => `$${usd.toFixed(2)}`;

/** One budget as a line: its scope, its period, what it spent of its limit, and what it does at the limit. */
export function budgetLine(budget: Budget): string {
  const scope = budget.scope === "project" ? `project ${budget.projectKey ?? ""}` : "host";
  const spent = spentOf(budget);
  return `${budget.id}  ${scope}  ${budget.period}  spent ${spent} (${percent(budget.fraction)})  ${budget.action}`;
}

/** What a budget spent of its limit: dollars for a dollar limit, a share (marked `~` when estimated) for a quota limit. */
function spentOf(budget: Budget): string {
  if (budget.limitPct === null) return `${dollars(budget.spentUsd)} of ${dollars(budget.limitUsd)}`;
  const estimate = budget.estimated ? "~" : "";
  return `${estimate}${percent(budget.spentPct ?? 0)} of ${percent(budget.limitPct)}`;
}

/** The line `watch` prints for a change: the budget as `budget list` says it, then the threshold it crossed or its removal. */
export function watchLine(change: {
  budget: Budget;
  threshold: number | null;
  removed: boolean;
}): string {
  return `${budgetLine(change.budget)}${changeNote(change)}`;
}

function changeNote(change: { threshold: number | null; removed: boolean }): string {
  if (change.removed) return "  removed";
  if (change.threshold === null) return "";
  return `  crossed ${percent(change.threshold)}`;
}

/** One line per budget, or a sentence when there is none. */
export const budgetLines = (budgets: Budget[]): string[] =>
  budgets.length === 0 ? ["no budget yet"] : budgets.map(budgetLine);
