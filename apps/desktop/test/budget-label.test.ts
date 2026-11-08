import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { budgetLabel } from "../src/lib/budgets.ts";

/**
 * Issue #1216: the en list read "of app budget (month)" for a project budget, because the "of"
 * of the pt-BR word order ("orçamento de app") was in the en scope too. The label names the
 * budget the way each language says it, in the list and in the alert built from it.
 */
describe("budget-label: a budget's name reads in each language (#1216)", () => {
  const project = { scope: "project", projectKey: "github.com/acme/app", period: "month" } as const;
  const host = { scope: "host", projectKey: null, period: "day" } as const;

  test("en: 'app budget (month)' and 'host budget (day)'", () => {
    const t = translator("en");
    expect([budgetLabel(project, t), budgetLabel(host, t)]).toEqual([
      "app budget (month)",
      "host budget (day)",
    ]);
  });

  test("pt-BR: 'orçamento de app (mês)' and 'orçamento do host (dia)'", () => {
    const t = translator("pt-BR");
    expect([budgetLabel(project, t), budgetLabel(host, t)]).toEqual([
      "orçamento de app (mês)",
      "orçamento do host (dia)",
    ]);
  });
});
