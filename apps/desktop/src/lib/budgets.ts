import type { Budget } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";
import { usd } from "./costs.ts";

export const ACTION_LABELS: Record<Budget["action"], string> = {
  notify: "notificar",
  queue: "segurar cards novos",
};

/** "orçamento do host (dia)", "orçamento de <projeto> (mês)". */
export function budgetLabel(budget: Pick<Budget, "scope" | "projectKey" | "period">): string {
  const scope = budget.scope === "host" ? "do host" : `de ${budget.projectKey}`;
  return `orçamento ${scope} (${budget.period === "day" ? "dia" : "mês"})`;
}

/** "orçamento do host (dia) · notificar · US$ 6.00 de US$ 10.00 (60%)". */
export function budgetLine(budget: Budget): string {
  const percent = Math.round(budget.fraction * 100);
  return `${budgetLabel(budget)} · ${ACTION_LABELS[budget.action]} · ${usd(budget.spentUsd)} de ${usd(budget.limitUsd)} (${percent}%)`;
}

export interface BudgetAlert {
  hostId: string;
  label: string;
}

/** Budgets that crossed a threshold in their current period, for "Precisa de você". */
export function budgetAlerts(state: AppState): BudgetAlert[] {
  return state.hosts.flatMap((host) =>
    (state.budgets[host.id] ?? [])
      .filter((b) => b.crossed.length > 0)
      .map((b) => ({
        hostId: host.id,
        label: `${host.name} · ${budgetLabel(b)}: ${Math.round(b.fraction * 100)}% de ${usd(b.limitUsd)}`,
      })),
  );
}
