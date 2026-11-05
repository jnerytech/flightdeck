import { describe, expect, test } from "bun:test";
import type { Budget, CostsSummary, UsageRow, UsageSummary } from "@flightdeck/protocol";
import { emptySummary } from "../src/lib/client-costs.ts";
import { homeKpis } from "../src/lib/home-kpis.ts";

const DAYS = [
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
];

function costs(
  byDay: Array<[string, number, number]>,
  tokens: Partial<CostsSummary["totals"]["tokens"]> = {},
): CostsSummary {
  const summary = emptySummary(DAYS[0] as string, DAYS[6] as string);
  summary.byDay = byDay.map(([day, costUsd, t]) => ({ day, projectKey: "p", costUsd, tokens: t }));
  summary.totals.costUsd = byDay.reduce((sum, d) => sum + d[1], 0);
  Object.assign(summary.totals.tokens, tokens);
  return summary;
}

const row = (day: string, extra: Partial<UsageRow> = {}): UsageRow => ({
  day,
  projectKey: "p",
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  turns: 0,
  failedTurns: 0,
  durationMs: 0,
  ...extra,
});
const usage = (...rows: UsageRow[]): UsageSummary => ({ days: 7, rows });

const input = (over: Partial<Parameters<typeof homeKpis>[0]> = {}) => ({
  days: DAYS,
  costs: [],
  usage: [],
  budgets: [],
  ...over,
});

describe("home-kpis: the four cards of Home from what the hosts already count", () => {
  test("spend adds the hosts' days, oldest first, with a zero for a day with nothing", () => {
    const kpis = homeKpis(
      input({
        costs: [
          costs([
            ["2026-10-10", 1.5, 0],
            ["2026-10-08", 0.5, 0],
          ]),
          costs([["2026-10-10", 0.25, 0]]),
        ],
      }),
    );
    expect(kpis.spend.totalUsd).toBeCloseTo(2.25);
    expect(kpis.spend.series).toEqual([0, 0, 0, 0, 0.5, 0, 1.75]);
    expect(kpis.spend.budget).toBeNull();
  });

  test("the month's host budgets together say what is spent of what is allowed; a day budget or a project's does not count", () => {
    const budget = (over: Partial<Budget>): Budget => ({
      id: "b",
      scope: "host",
      projectKey: null,
      period: "month",
      limitUsd: 100,
      action: "notify",
      createdAt: "",
      periodKey: "2026-10",
      spentUsd: 10,
      fraction: 0.1,
      crossed: [],
      ...over,
    });
    const kpis = homeKpis(
      input({
        budgets: [
          budget({}),
          budget({ limitUsd: 50, spentUsd: 5 }),
          budget({ period: "day", limitUsd: 9 }),
          budget({ scope: "project", projectKey: "p", limitUsd: 7 }),
        ],
      }),
    );
    expect(kpis.spend.budget).toEqual({ spentUsd: 15, limitUsd: 150 });
  });

  test("turns add up across hosts, with the ones that failed", () => {
    const kpis = homeKpis(
      input({
        usage: [
          usage(row("2026-10-10", { turns: 5, failedTurns: 1 }), row("2026-10-09", { turns: 3 })),
          usage(row("2026-10-10", { turns: 2, failedTurns: 1 })),
        ],
      }),
    );
    expect(kpis.turns).toMatchObject({ total: 10, ok: 8, failed: 2 });
    expect(kpis.turns.series).toEqual([0, 0, 0, 0, 0, 3, 7]);
  });

  test("a host that does not count failures leaves the failed turns unknown, not zero", () => {
    const old = usage({
      day: "2026-10-10",
      projectKey: "p",
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      turns: 4,
    });
    const kpis = homeKpis(input({ usage: [usage(row("2026-10-10", { turns: 1 })), old] }));
    expect(kpis.turns).toMatchObject({ total: 5, failed: null });
    expect(kpis.average.successRate).toBeNull();
  });

  test("tokens are all the kinds together, with what came from the cache", () => {
    const kpis = homeKpis(
      input({
        costs: [
          costs([["2026-10-10", 1, 700]], {
            input: 100,
            output: 200,
            cacheRead: 300,
            cacheWrite5m: 50,
            cacheWrite1h: 50,
          }),
          costs([["2026-10-09", 1, 100]], { input: 40, output: 60 }),
        ],
      }),
    );
    expect(kpis.tokens).toMatchObject({ total: 800, cacheRead: 300 });
    expect(kpis.tokens.series).toEqual([0, 0, 0, 0, 0, 100, 700]);
  });

  test("the average of a turn: its cost, its time and how many succeed", () => {
    const kpis = homeKpis(
      input({
        usage: [
          usage(
            row("2026-10-10", { turns: 3, failedTurns: 1, costUsd: 0.6, durationMs: 12_000 }),
            row("2026-10-09", { turns: 1, costUsd: 0.1, durationMs: 4000 }),
          ),
        ],
      }),
    );
    expect(kpis.average.costPerTurnUsd).toBeCloseTo(0.175);
    expect(kpis.average.turnMs).toBe(4000);
    expect(kpis.average.successRate).toBeCloseTo(0.75);
    expect(kpis.average.series[6]).toBeCloseTo(0.2);
    expect(kpis.average.series[5]).toBeCloseTo(0.1);
  });

  test("with no turns the averages are unknown, never a division by zero", () => {
    const kpis = homeKpis(input({ usage: [usage()] }));
    expect(kpis.turns).toMatchObject({ total: 0, ok: 0, failed: 0 });
    expect(kpis.average).toMatchObject({ costPerTurnUsd: null, turnMs: null, successRate: null });
  });

  test("days from before the host counted failures and time are unknown: the averages use the days that know, and the failed turns stay unknown (HK-M1)", () => {
    const legacy = { ...row("2026-10-09", { turns: 10, costUsd: 1 }) } as UsageRow;
    delete legacy.failedTurns;
    delete legacy.durationMs;
    const kpis = homeKpis(
      input({
        usage: [
          usage(
            legacy,
            row("2026-10-10", { turns: 4, failedTurns: 1, durationMs: 4000, costUsd: 1 }),
          ),
        ],
      }),
    );
    expect(kpis.turns).toMatchObject({ total: 14, failed: null, ok: 14 });
    // 4 s over the 4 turns that were timed; 3 of those 4 succeeded: never 4 s over 14 turns.
    expect(kpis.average.turnMs).toBe(1000);
    expect(kpis.average.successRate).toBe(0.75);
  });
});
