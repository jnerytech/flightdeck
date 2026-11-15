import type { Budget, BudgetInput, QuotaBudgetInput } from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";

export interface Draft {
  id?: string;
  scope: Budget["scope"];
  projectKey: string;
  /** The project is one the list does not have: its key is typed. */
  other: boolean;
  /** What the limit is measured in: dollars, or a share of a plan quota window (issue #1248). */
  unit: "usd" | QuotaBudgetInput["window"];
  period: BudgetInput["period"];
  limitUsd: string;
  /** The share of the window, in percent as typed. */
  limitPct: string;
  action: Budget["action"];
}

export const EMPTY: Draft = {
  scope: "host",
  projectKey: "",
  other: false,
  unit: "usd",
  period: "day",
  limitUsd: "",
  limitPct: "",
  action: "notify",
};

/** The smallest share the daemon takes, in percent. */
export const MIN_PCT = 0.1;

/** The form filled with a saved budget, for editing it. */
export function draftOf(budget: Budget): Draft {
  const pct = budget.limitPct;
  return {
    id: budget.id,
    scope: budget.scope,
    projectKey: budget.projectKey ?? "",
    other: false,
    unit: pct === null ? "usd" : (budget.period as Draft["unit"]),
    period: budget.period === "month" ? "month" : "day",
    limitUsd: pct === null ? String(budget.limitUsd) : "",
    limitPct: pct === null ? "" : String(Number((pct * 100).toPrecision(12))),
    action: budget.action,
  };
}

/** What stops the form from saving, or `null` when it can be saved. */
export function missingOf(draft: Draft, t: T): string | null {
  const byShare = draft.unit !== "usd";
  const limit = Number(byShare ? draft.limitPct : draft.limitUsd);
  if (byShare && (draft.limitPct.trim() === "" || !(limit >= MIN_PCT && limit <= 100))) {
    return t("budgetsUi.pctNeeded");
  }
  if (Number.isNaN(limit) || limit <= 0) return t("budgetsUi.limitNeeded");
  if (draft.scope === "project" && draft.projectKey.trim() === "") {
    return t("budgetsUi.projectNeeded");
  }
  return null;
}
