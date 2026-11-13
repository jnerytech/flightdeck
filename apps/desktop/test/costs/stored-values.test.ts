import { describe, expect, test } from "bun:test";
import { emptySummary } from "../../src/features/clients/client-costs.ts";
import {
  type ClientBudgetsCore,
  ClientBudgetsSlice,
} from "../../src/features/costs/client-budgets-store.ts";
import { CLIENT_BUDGET_ALERTS_KEY } from "../../src/features/costs/domain/client-budgets.ts";

/** A slice over a storage that holds what a test plants; the host answers with a month of nothing. */
function sliceOver(announced: string) {
  const items = new Map([[CLIENT_BUDGET_ALERTS_KEY, announced]]);
  const core = {
    state: () => ({ clientBudgets: [] }),
    update: () => {},
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    },
    limits: () => ({ acme: 4 }),
    hostsWithCosts: () => ["h1"],
    today: () => "2026-10-15",
    scope: () => ({ clientOf: () => "acme" }),
    clients: () => [],
    summary: async () => emptySummary("2026-10-01", "2026-10-15"),
    feed: () => {},
    notify: () => {},
    t: () => ({ lang: "en" }),
  } as unknown as ClientBudgetsCore;
  return { slice: new ClientBudgetsSlice(core), items };
}

describe("the client budgets' announcements are parsed, not trusted (#1609)", () => {
  test("a client's announcements that are not a list of numbers are forgotten", async () => {
    const { slice, items } = sliceOver('{"acme|2026-10":"oops","beta|2026-10":[0.5,"x"]}');
    await slice.check();
    expect(JSON.parse(items.get(CLIENT_BUDGET_ALERTS_KEY) ?? "null")).toEqual({});
  });
});
