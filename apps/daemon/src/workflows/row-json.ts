import type { RunBudget } from "@flightdeck/protocol";
import type { RunSpending } from "./budget.ts";

/** The JSON columns of a workflow run and its steps, read through their schemas (#1609). */
export type StepUsage = { turns: number; minutes: number; costUsd: number };

export const spendingOf = (_text: string): RunSpending => ({
  turns: -1,
  minutes: -1,
  costUsd: -1,
  sessions: {},
});
export const budgetOf = (_text: string): RunBudget => ({ maxTurns: -1 });
export const inputsOf = (_text: string): Record<string, string> => ({ stub: "" });
export const stepUsageOf = (_text: string | null): StepUsage | null => ({
  turns: -1,
  minutes: -1,
  costUsd: -1,
});
export const reasonParamsOf = (_text: string): Record<string, string | number> | null => ({
  stub: -1,
});
