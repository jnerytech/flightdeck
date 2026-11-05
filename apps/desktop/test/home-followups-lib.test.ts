import { describe, expect, test } from "bun:test";
import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { emptySummary } from "../src/lib/client-costs.ts";
import { homeKpis } from "../src/lib/home-kpis.ts";

const DAYS = ["2026-10-09", "2026-10-10"];
const costs = (): CostsSummary => {
  const summary = emptySummary("2026-10-04", "2026-10-10");
  summary.byDay = [{ day: "2026-10-10", projectKey: "p", costUsd: 2, tokens: 1000 }];
  Object.assign(summary.totals.tokens, { input: 400, output: 400, cacheRead: 200 });
  return summary;
};
const usage: UsageSummary = {
  days: 7,
  rows: [
    {
      day: "2026-10-10",
      projectKey: "p",
      costUsd: 0.8,
      inputTokens: 1,
      outputTokens: 1,
      turns: 4,
      failedTurns: 0,
      durationMs: 10_000,
    },
  ],
};

describe("home-followups-lib: no costs is unknown, not zero (issue #211)", () => {
  test("with no host giving costs, spend and tokens are unknown", () => {
    const kpis = homeKpis({ days: DAYS, costs: [], usage: [usage], budgets: [] });
    expect(kpis.spend.totalUsd).toBeNull();
    expect(kpis.tokens.total).toBeNull();
    expect(kpis.tokens.cacheRead).toBeNull();
    // The turns come from the usage counters, which every host has.
    expect(kpis.turns.total).toBe(4);
    expect(kpis.average.costPerTurnUsd).toBeCloseTo(0.2);
  });

  test("with costs from even one host they are numbers, as before", () => {
    const kpis = homeKpis({ days: DAYS, costs: [costs()], usage: [usage], budgets: [] });
    expect(kpis.spend.totalUsd).toBe(2);
    expect(kpis.spend.series).toEqual([0, 2]);
    expect(kpis.tokens.total).toBe(1000);
    expect(kpis.tokens.cacheRead).toBe(200);
  });

  test("a spend of nothing is still a number when a host did give costs", () => {
    const empty = emptySummary("2026-10-04", "2026-10-10");
    const kpis = homeKpis({ days: DAYS, costs: [empty], usage: [], budgets: [] });
    expect(kpis.spend.totalUsd).toBe(0);
    expect(kpis.tokens.total).toBe(0);
  });
});
