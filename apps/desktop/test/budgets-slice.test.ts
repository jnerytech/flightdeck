import { describe, expect, test } from "bun:test";
import type { Budget } from "@flightdeck/protocol";
import {
  type BudgetsCore,
  BudgetsSlice,
  budgetLabel,
  budgetLimitText,
  initialBudgetsState,
  share,
} from "../src/features/budgets/index.ts";
import { translator } from "../src/i18n/index.ts";
import { usd } from "../src/lib/costs.ts";

const budget = (id: string, createdAt: string, extra: Partial<Budget> = {}) =>
  ({
    id,
    createdAt,
    projectKey: null,
    period: "month",
    limitUsd: 10,
    limitPct: null,
    action: "notify",
    ...extra,
  }) as Budget;

/** A slice over a bare state, with a host that answers from the given budget (null: it refuses). */
function slice(answer: Budget | null = null) {
  let state = initialBudgetsState();
  const fed: string[] = [];
  const notified: Array<{ title: string; body: string; host: string; projectKey?: string }> = [];
  const core: BudgetsCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    set: async () => answer,
    setQuota: async () => answer,
    remove: async () => (answer ? undefined : null),
    hostName: (hostId) => (hostId === "h1" ? "Casa" : undefined),
    feed: (host, label, percent, limit) => fed.push(`${host.name}|${label}|${percent}|${limit}`),
    notify: (n, route) => notified.push({ ...n, host: route.host, projectKey: route.projectKey }),
    t: () => translator("en"),
  };
  return { slice: new BudgetsSlice(core), state: () => state, fed, notified };
}

describe("the budgets slice", () => {
  test("a set budget joins its host's list, oldest first, and a changed one replaces itself", async () => {
    const newer = budget("b2", "2026-02-01");
    const s = slice(newer);
    await s.slice.set("h1", {} as never);
    s.slice.replace("h1", [
      budget("b1", "2026-01-01"),
      budget("b2", "2026-02-01", { limitUsd: 5 }),
    ]);
    await s.slice.set("h1", {} as never);
    expect(s.state().budgets.h1?.map((b) => [b.id, b.limitUsd])).toEqual([
      ["b1", 10],
      ["b2", 10],
    ]);
  });

  test("a host that refuses changes nothing; a removal drops the budget from the list", async () => {
    const refused = slice(null);
    await refused.slice.setQuota("h1", {} as never);
    await refused.slice.remove("h1", budget("b1", "2026-01-01"));
    expect(refused.state().budgets).toEqual({});
    const s = slice(budget("b1", "2026-01-01"));
    s.slice.replace("h1", [budget("b1", "2026-01-01"), budget("b2", "2026-02-01")]);
    await s.slice.remove("h1", budget("b1", "2026-01-01"));
    expect(s.state().budgets.h1?.map((b) => b.id)).toEqual(["b2"]);
  });

  test("a crossed threshold feeds the webhook and notifies once, naming the host and project", () => {
    const s = slice();
    const crossed = budget("b1", "2026-01-01", { projectKey: "/srv/web" });
    s.slice.onUpdated("h1", { budget: crossed, removed: false, threshold: 0.8 } as never);
    const t = translator("en");
    expect(s.fed).toEqual([`Casa|${budgetLabel(crossed, t)}|80|${budgetLimitText(crossed, t)}`]);
    expect(s.notified).toHaveLength(1);
    expect(s.notified[0]?.body).toContain("Casa");
    expect(s.notified[0]?.body).toContain(usd(10, "en"));
    expect(s.notified[0]).toMatchObject({ host: "h1", projectKey: "/srv/web" });
  });

  test("a plan quota budget names its share of the window, not a dollar limit", () => {
    const s = slice();
    const quota = budget("q1", "2026-01-01", {
      period: "five_hour",
      limitUsd: null,
      limitPct: 0.5,
    });
    s.slice.onUpdated("h1", { budget: quota, removed: false, threshold: 0.9 } as never);
    const t = translator("en");
    expect(s.fed).toEqual([`Casa|${budgetLabel(quota, t)}|90|${budgetLimitText(quota, t)}`]);
    expect(s.notified[0]?.body).toContain(share(0.5, "en"));
    expect(s.notified[0]?.body).not.toContain("$");
  });

  test("an update without a threshold, or for an unknown host, only keeps the budget", () => {
    const s = slice();
    s.slice.onUpdated("h1", {
      budget: budget("b1", "2026-01-01"),
      removed: false,
      threshold: null,
    } as never);
    s.slice.onUpdated("nope", {
      budget: budget("b9", "2026-01-01"),
      removed: false,
      threshold: 0.9,
    } as never);
    expect(s.notified).toEqual([]);
    expect(s.fed).toEqual([]);
    expect(s.state().budgets.h1?.map((b) => b.id)).toEqual(["b1"]);
    expect(s.state().budgets.nope?.map((b) => b.id)).toEqual(["b9"]);
  });
});
