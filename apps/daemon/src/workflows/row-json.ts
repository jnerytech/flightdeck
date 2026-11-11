import { RunBudget, RunUsage } from "@flightdeck/protocol";
import { z } from "zod";
import { parseJsonOr, parseJsonWith } from "../json-text.ts";
import type { RunSpending } from "./budget.ts";

/** The JSON columns of a workflow run and its steps, read through their schemas (#1609). */
const Spending = RunUsage.extend({ sessions: z.record(z.string(), z.number()).default({}) });
const Inputs = z.record(z.string(), z.string());
const ReasonParams = z.record(z.string(), z.union([z.string(), z.number()]));

/** What a run spent. Throws when it does not fit: a lost tally would let the run pass its budget. */
export const spendingOf = (text: string): RunSpending => parseJsonWith(Spending, text);
/** What a run spent, as the wire shows it: without the per-session tally. */
export const runUsageOf = (text: string): RunUsage => parseJsonWith(RunUsage, text);
export const budgetOf = (text: string): RunBudget => parseJsonWith(RunBudget, text);
export const inputsOf = (text: string): Record<string, string> => parseJsonWith(Inputs, text);

/** What one step spent; none when the column is empty or unreadable (it is only shown). */
export const stepUsageOf = (text: string | null): RunUsage | null =>
  text ? parseJsonOr(RunUsage, text, null) : null;

export const reasonParamsOf = (text: string | null): Record<string, string | number> | null =>
  text ? parseJsonOr(ReasonParams, text, null) : null;

/** The columns of a run row the app is shown; each degrades alone instead of hiding the run. */
export const shownOf = (_row: {
  budget: string;
  usage: string;
  inputs: string;
  status_reason_params: string | null;
}): {
  budget: RunBudget;
  usage: RunUsage;
  inputs: Record<string, string>;
  reasonParams: Record<string, string | number> | null;
} => ({
  budget: { maxTurns: -1 },
  usage: { turns: -1, minutes: 0, costUsd: 0 },
  inputs: {},
  reasonParams: {},
});
