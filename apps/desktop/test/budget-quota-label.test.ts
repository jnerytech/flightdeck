import { describe, expect, test } from "bun:test";
import type { Budget } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { budgetAlerts, budgetLabel, budgetLine } from "../src/lib/budgets.ts";

/**
 * Issue #1248: a budget in terms of the plan window is named by its window and read as a share
 * of the plan, not in dollars; a project's share says it is an estimate.
 */
const window = (extra: Partial<Budget>): Budget => ({
  id: "b1",
  scope: "host",
  projectKey: null,
  period: "five_hour",
  limitUsd: 0,
  limitPct: 0.5,
  action: "notify",
  createdAt: "2026-10-15T12:00:00.000Z",
  periodKey: "2026-10-15T14:00:00.000Z",
  spentUsd: 0,
  spentPct: 0.2,
  estimated: false,
  fraction: 0.4,
  crossed: [],
  ...extra,
});

describe("budget-quota-label: a window budget in each language (#1248)", () => {
  const project = { scope: "project", projectKey: "github.com/acme/app" } as const;

  test("en: the label names the window, the line reads as shares of the plan", () => {
    const t = translator("en");
    expect(budgetLabel(window({}), t)).toBe("host budget (5-hour window)");
    expect(budgetLabel(window({ ...project, period: "seven_day" }), t)).toBe(
      "app budget (weekly window)",
    );
    expect(budgetLine(window({}), t)).toBe(
      "host budget (5-hour window) · notify · 20% of 50% of the plan (40%)",
    );
  });

  test("en: a project's share says it is an estimate", () => {
    const t = translator("en");
    const line = budgetLine(
      window({
        ...project,
        period: "seven_day",
        action: "queue",
        spentPct: 0.125,
        estimated: true,
      }),
      t,
    );
    expect(line).toBe(
      "app budget (weekly window) · hold new cards · 12.5% of 50% of the plan (40%) · estimate",
    );
  });

  test("pt-BR: label, line and the estimate note", () => {
    const t = translator("pt-BR");
    expect(budgetLabel(window({ period: "seven_day" }), t)).toBe(
      "orçamento do host (janela semanal)",
    );
    expect(budgetLine(window({ ...project, estimated: true }), t)).toBe(
      "orçamento de app (janela de 5 horas) · notificar · 20% de 50% do plano (40%) · estimativa",
    );
  });

  test("a dollar budget reads as it did", () => {
    const t = translator("en");
    const dollars = window({
      period: "month",
      limitUsd: 10,
      limitPct: null,
      spentPct: null,
      spentUsd: 6,
      fraction: 0.6,
    });
    expect(budgetLine(dollars, t)).toBe(
      "host budget (month) · notify · US$ 6.00 of US$ 10.00 (60%)",
    );
  });

  test("the alert of a window budget speaks in shares of the plan, with the estimate note", () => {
    const state = {
      hosts: [{ id: "h1", name: "alfa" }],
      budgets: {
        h1: [
          window({ fraction: 1, crossed: [0.5, 0.8, 1] }),
          window({ ...project, id: "b2", fraction: 0.8, estimated: true, crossed: [0.5, 0.8] }),
        ],
      },
      clientBudgets: [],
      clientList: [],
    } as unknown as AppState;
    expect(budgetAlerts(state, translator("en")).map((a) => a.label)).toEqual([
      "alfa · host budget (5-hour window): 100% of its 50% of the plan",
      "alfa · app budget (5-hour window): 80% of its 50% of the plan · estimate",
    ]);
    expect(budgetAlerts(state, translator("pt-BR"))[1]?.label).toBe(
      "alfa · orçamento de app (janela de 5 horas): 80% de 50% do plano · estimativa",
    );
  });
});
