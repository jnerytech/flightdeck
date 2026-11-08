import type { StepRun, WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";

const PT = translator("pt-BR");

/** How long a step took (or has taken so far), roughly. */
export function stepDuration(step: StepRun, now = Date.now()): string {
  const end = step.endedAt ? Date.parse(step.endedAt) : now;
  const seconds = Math.max(0, Math.round((end - Date.parse(step.startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** What an agent step's turns spent: `1 turno · US$ 0.50`. */
export function stepUsage(usage: NonNullable<StepRun["usage"]>, t: T = PT): string {
  return `${t("runUi.turns", { n: usage.turns })} · US$ ${usage.costUsd.toFixed(2)}`;
}

export interface BudgetLine {
  label: string;
  text: string;
  /** For the meter; absent when the run has no such limit. */
  value: number;
  max?: number;
}

/** Turns, minutes and estimated cost of a run against its limits. */
export function budgetLines(run: WorkflowRun, t: T = PT): BudgetLine[] {
  const { usage, budget } = run;
  const line = (label: string, value: number, shown: string, max?: number, maxShown?: string) => ({
    label,
    value,
    max,
    text:
      max === undefined
        ? t("runUi.budgetNoLimit", { label, shown })
        : t("runUi.budgetLine", { label, shown, max: maxShown ?? "" }),
  });
  return [
    line(
      t("runUi.budgetTurns"),
      usage.turns,
      String(usage.turns),
      budget.maxTurns,
      String(budget.maxTurns),
    ),
    line(
      t("runUi.budgetMinutes"),
      usage.minutes,
      usage.minutes.toFixed(1),
      budget.maxMinutes,
      String(budget.maxMinutes),
    ),
    line(
      t("runUi.budgetCost"),
      usage.costUsd,
      `US$ ${usage.costUsd.toFixed(2)}`,
      budget.maxCostUsd,
      `US$ ${budget.maxCostUsd?.toFixed(2)}`,
    ),
  ];
}

/** What a failed run offers (issue #1219): "Run again", or why it cannot be offered now. */
export type RunAgainState =
  | { show: false }
  | { show: true; off: null | "loading" | "missing" | "untrusted" | "invalid" };

/**
 * A failed run (a stopped one ends failed too) can run again with the same workflow and inputs
 * unless the file is the problem: gone from the base branch, changed since it was trusted, or with
 * errors. `workflow` is the host's current word on that file; `known` is false until it answered.
 */
export function runAgain(
  _run: Pick<WorkflowRun, "status">,
  _workflow: Pick<WorkflowInfo, "trusted" | "errors"> | undefined,
  _known: boolean,
): RunAgainState {
  return { show: false };
}
