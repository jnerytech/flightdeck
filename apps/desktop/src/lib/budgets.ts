import type { Budget } from "@flightdeck/protocol";
import { type Key, type T, translator } from "../i18n/index.ts";
import type { AppState } from "./app-store.ts";
import { usd } from "./costs.ts";

export const ACTION_LABELS: Record<Budget["action"], string> = {
  notify: "notificar",
  queue: "segurar cards novos",
};

const PT = translator("pt-BR");

/** The last folder of a project's key ("/srv/work/web" is "web"); a key that is no path stays. */
export const projectName = (key: string): string => key.split(/[\\/]+/).findLast(Boolean) ?? key;

const PERIOD_KEYS: Record<Budget["period"], Key> = {
  day: "budgets.day",
  month: "budgets.month",
  five_hour: "budgets.fiveHour",
  seven_day: "budgets.sevenDay",
};

/** A share of the plan as text: 0.2 is "20%", 0.125 is "12.5%". */
const share = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/** "orçamento do host (dia)". */
export function budgetLabel(
  budget: Pick<Budget, "scope" | "projectKey" | "period">,
  t: T = PT,
): string {
  const scope =
    budget.scope === "host"
      ? t("budgets.scopeHost")
      : t("budgets.scopeProject", { project: projectName(budget.projectKey ?? "") });
  return t("budgets.label", {
    scope,
    period: t(PERIOD_KEYS[budget.period]),
  });
}

/** The note on a project's share of a window: the plan does not say who used it. */
const estimateNote = (budget: Budget, t: T) => (budget.estimated ? t("budgets.estimate") : "");

/** "orçamento do host (dia) · notificar · US$ 6.00 de US$ 10.00 (60%)". */
export function budgetLine(budget: Budget, t: T = PT): string {
  if (budget.limitPct !== null) {
    return t("budgets.lineQuota", {
      label: budgetLabel(budget, t),
      action: t(`budgets.${budget.action}` as Key),
      spent: share(budget.spentPct ?? 0),
      limit: share(budget.limitPct),
      percent: Math.round(budget.fraction * 100),
      estimate: estimateNote(budget, t),
    });
  }
  return t("budgets.line", {
    label: budgetLabel(budget, t),
    action: t(`budgets.${budget.action}` as Key),
    spent: usd(budget.spentUsd),
    limit: usd(budget.limitUsd),
    percent: Math.round(budget.fraction * 100),
  });
}

export interface BudgetAlert {
  /** The host whose budget crossed a threshold; empty for a client's (phase 29). */
  hostId: string;
  label: string;
  /** The client whose month limit crossed a threshold. */
  clientId?: string;
}

/** Budgets that crossed a threshold in their current period, for "Precisa de você". */
export function budgetAlerts(state: AppState, t: T = PT): BudgetAlert[] {
  const hosts = state.hosts.flatMap((host) =>
    (state.budgets[host.id] ?? [])
      .filter((b) => b.crossed.length > 0)
      .map((b) => ({
        hostId: host.id,
        label:
          b.limitPct === null
            ? t("budgets.alert", {
                host: host.name,
                label: budgetLabel(b, t),
                percent: Math.round(b.fraction * 100),
                limit: usd(b.limitUsd),
              })
            : t("budgets.alertQuota", {
                host: host.name,
                label: budgetLabel(b, t),
                percent: Math.round(b.fraction * 100),
                limit: share(b.limitPct),
                estimate: estimateNote(b, t),
              }),
      })),
  );
  // A client's month limit, kept by the app (phase 29).
  const clients = (state.clientBudgets ?? [])
    .filter((b) => b.crossed.length > 0)
    .map((b) => ({
      hostId: "",
      clientId: b.clientId,
      label: t("clients.budgetAlert", {
        name: state.clientList.find((c) => c.id === b.clientId)?.name ?? b.clientId,
        percent: Math.round(b.fraction * 100),
        limit: usd(b.limitUsd),
      }),
    }));
  return [...hosts, ...clients];
}
