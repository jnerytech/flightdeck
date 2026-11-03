import { describe, expect, test } from "bun:test";
import type { RoiPeriod, RoiWeek } from "@flightdeck/protocol";
import { EMPTY_PERIOD, figures, mergePeriods, type RoiMoney } from "../src/lib/roi.ts";

const period = (over: Partial<RoiPeriod> = {}): RoiPeriod => ({ ...EMPTY_PERIOD, ...over });
const NO_MONEY: RoiMoney = {
  rate: null,
  billed: null,
  planShareUsd: null,
  countReview: false,
  reviewCapSeconds: 300,
};
const week = (n: number, over: Partial<RoiWeek> = {}): RoiWeek => ({
  from: `2026-10-${String(n).padStart(2, "0")}`,
  to: `2026-10-${String(n + 6).padStart(2, "0")}`,
  costUsd: 0,
  tokens: 0,
  cards: 0,
  planned: 0,
  unplanned: 0,
  prsMerged: 0,
  ...over,
});

describe("roi-calculo: the arithmetic and where each number comes from", () => {
  test("without money typed, the cost per unit shows and no value or ROI does", () => {
    const f = figures(period({ costUsd: 12, cards: 3, prsMerged: 2 }), NO_MONEY);
    expect(f).toMatchObject({
      costUsd: 12,
      cards: 3,
      prsMerged: 2,
      costPerCard: 4,
      costPerPr: 6,
      valueUsd: null,
      roi: null,
    });
  });

  test("hours times the rate is the estimated value, and the ROI is (value - cost) / cost", () => {
    const f = figures(period({ costUsd: 12, cards: 3, hours: 6 }), { ...NO_MONEY, rate: 60 });
    expect(f.valueUsd).toBe(360);
    expect(f.roi).toBe(29);
  });

  test("a billed amount adds to the value", () => {
    const f = figures(period({ costUsd: 10, cards: 1, hours: 1 }), {
      ...NO_MONEY,
      rate: 50,
      billed: 100,
    });
    expect(f.valueUsd).toBe(150);
    expect(f.roi).toBe(14);
  });

  test("a billed amount alone is a value even without a rate", () => {
    const f = figures(period({ costUsd: 10, cards: 1 }), { ...NO_MONEY, billed: 40 });
    expect(f.valueUsd).toBe(40);
    expect(f.roi).toBe(3);
  });

  test("no ROI without a cost, and no cost per unit without a count", () => {
    const f = figures(period({ costUsd: 0, cards: 0, hours: 5 }), { ...NO_MONEY, rate: 60 });
    expect(f).toMatchObject({ valueUsd: 300, roi: null, costPerCard: null, costPerPr: null });
  });

  test("the plan's share and the review time (capped per decision) add to the cost when asked", () => {
    const base = period({ costUsd: 10, cards: 2, decisions: 4, waitedSeconds: 4000 });
    expect(figures(base, { ...NO_MONEY, planShareUsd: 5 })).toMatchObject({
      agentsCostUsd: 10,
      planShareUsd: 5,
      reviewCostUsd: 0,
      costUsd: 15,
    });
    // 4 decisions, at most 300 s each: 1200 s of the 4000 s waited, at 60 an hour: 20.
    const counted = figures(base, { ...NO_MONEY, rate: 60, countReview: true });
    expect(counted.reviewCostUsd).toBe(20);
    expect(counted.costUsd).toBe(30);
    // The wait is not review time unless asked.
    expect(figures(base, { ...NO_MONEY, rate: 60 }).reviewCostUsd).toBe(0);
    // Without a rate there is nothing to price the review with.
    expect(figures(base, { ...NO_MONEY, countReview: true }).reviewCostUsd).toBe(0);
  });

  test("a short wait counts as it was, not as the cap", () => {
    const f = figures(period({ costUsd: 0, decisions: 2, waitedSeconds: 120 }), {
      ...NO_MONEY,
      rate: 60,
      countReview: true,
    });
    expect(f.reviewCostUsd).toBe(2);
  });

  test("the rework is the fix cost over the cost, and the fix rounds per merged PR", () => {
    const f = figures(
      period({ costUsd: 10, prsMerged: 2, fixRounds: 3, fixCostUsd: 1.5 }),
      NO_MONEY,
    );
    expect(f.reworkShare).toBe(0.15);
    expect(f.fixRoundsPerPr).toBe(1.5);
    const none = figures(period({ costUsd: 0, prsMerged: 0 }), NO_MONEY);
    expect(none.reworkShare).toBeNull();
    expect(none.fixRoundsPerPr).toBeNull();
  });

  test("two hosts with the same project add up, week by week", () => {
    const a = period({
      costUsd: 5,
      tokens: 100,
      cards: 2,
      planned: 1,
      unplanned: 1,
      weeks: [week(1, { cards: 2 })],
    });
    const b = period({
      costUsd: 7,
      tokens: 50,
      cards: 1,
      planned: 1,
      hours: 2,
      weeks: [week(1, { cards: 1, costUsd: 7 })],
    });
    const merged = mergePeriods([a, b]);
    expect(merged).toMatchObject({
      costUsd: 12,
      tokens: 150,
      cards: 3,
      planned: 2,
      unplanned: 1,
      hours: 2,
    });
    expect(merged.weeks).toHaveLength(1);
    expect(merged.weeks[0]).toMatchObject({ cards: 3, costUsd: 7 });
    expect(mergePeriods([])).toEqual(EMPTY_PERIOD);
  });

  test("every figure says how it was made, and what is an estimate is named as one", () => {
    const f = figures(period({ costUsd: 12, cards: 3, hours: 6, cardsWithoutEstimate: 2 }), {
      ...NO_MONEY,
      rate: 60,
    });
    const keys = f.derivation.map((line) => line.key);
    expect(keys).toEqual([
      "roiUi.derive.cost",
      "roiUi.derive.costPerCard",
      "roiUi.derive.hours",
      "roiUi.derive.noEstimate",
      "roiUi.derive.value",
      "roiUi.derive.roi",
    ]);
    const by = (key: string) => f.derivation.find((line) => line.key === key)?.vars;
    expect(by("roiUi.derive.cost")).toEqual({
      total: "12.00",
      agents: "12.00",
      plan: "0.00",
      review: "0.00",
    });
    expect(by("roiUi.derive.costPerCard")).toEqual({ cost: "12.00", n: 3, each: "4.00" });
    expect(by("roiUi.derive.hours")).toEqual({ hours: 6 });
    expect(by("roiUi.derive.noEstimate")).toEqual({ n: 2 });
    expect(by("roiUi.derive.value")).toEqual({
      hours: 6,
      rate: "60.00",
      billed: "0.00",
      value: "360.00",
    });
    expect(by("roiUi.derive.roi")).toEqual({ value: "360.00", cost: "12.00", roi: "29.0" });
  });

  test("without a rate the derivation stops at the cost per unit and says nothing about value", () => {
    const keys = figures(period({ costUsd: 12, cards: 3, prsMerged: 2 }), NO_MONEY).derivation.map(
      (line) => line.key,
    );
    expect(keys).toEqual([
      "roiUi.derive.cost",
      "roiUi.derive.costPerCard",
      "roiUi.derive.costPerPr",
      "roiUi.derive.hours",
    ]);
  });
});
