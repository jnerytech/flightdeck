import { describe, expect, test } from "bun:test";
import type { RoiPeriod } from "@flightdeck/protocol";
import { compare, EMPTY_PERIOD, headline } from "../src/lib/roi.ts";

const period = (over: Partial<RoiPeriod>): RoiPeriod => ({ ...EMPTY_PERIOD, ...over });

describe("roi-entregamos-mais: did we deliver more?", () => {
  test("more, fewer or about the same (within 5%), by the cards done", () => {
    const prev = period({ cards: 100, costUsd: 100 });
    expect(compare(period({ cards: 106, costUsd: 100 }), prev).verdict).toBe("more");
    expect(compare(period({ cards: 94, costUsd: 100 }), prev).verdict).toBe("fewer");
    expect(compare(period({ cards: 105, costUsd: 100 }), prev).verdict).toBe("same");
    expect(compare(period({ cards: 95, costUsd: 100 }), prev).verdict).toBe("same");
    expect(compare(period({ cards: 10 }), period({ cards: 10 })).verdict).toBe("same");
  });

  test("the change is a percent of the previous period, and absent when that delivered nothing", () => {
    expect(compare(period({ cards: 7 }), period({ cards: 4 })).deltaPercent).toBe(75);
    expect(compare(period({ cards: 7 }), period({ cards: 0 }))).toMatchObject({
      verdict: "more",
      deltaPercent: null,
    });
    expect(compare(period({ cards: 0 }), period({ cards: 4 }))).toMatchObject({
      verdict: "fewer",
      deltaPercent: -100,
    });
    expect(compare(period({ cards: 0 }), period({ cards: 0 })).verdict).toBe("none");
  });

  test("the cost per item of both periods, and which way it moved, never dividing by zero", () => {
    const c = compare(period({ cards: 7, costUsd: 28 }), period({ cards: 4, costUsd: 31 }));
    expect(c).toMatchObject({
      costPerItem: 4,
      previousCostPerItem: 7.75,
      costPerItemMoved: "lower",
    });
    expect(
      compare(period({ cards: 2, costUsd: 20 }), period({ cards: 2, costUsd: 10 }))
        .costPerItemMoved,
    ).toBe("higher");
    expect(
      compare(period({ cards: 2, costUsd: 10.2 }), period({ cards: 2, costUsd: 10 }))
        .costPerItemMoved,
    ).toBe("same");
    expect(
      compare(period({ cards: 0, costUsd: 5 }), period({ cards: 2, costUsd: 10 })),
    ).toMatchObject({
      costPerItem: null,
      costPerItemMoved: null,
    });
    expect(
      compare(period({ cards: 2, costUsd: 5 }), period({ cards: 0, costUsd: 0 })),
    ).toMatchObject({
      previousCostPerItem: null,
      costPerItemMoved: null,
    });
  });

  test("the headline is a dictionary key with the numbers, for each situation", () => {
    expect(
      headline(
        period({ cards: 7, planned: 5, unplanned: 2, costUsd: 28 }),
        period({ cards: 4, planned: 4, costUsd: 31 }),
      ),
    ).toEqual({
      key: "roiUi.headline.more",
      vars: { n: 7, planned: 5, unplanned: 2, cost: "28.00", previous: 4, moved: "lower" },
    });
    expect(headline(period({ cards: 10, costUsd: 5 }), period({ cards: 10, costUsd: 5 })).key).toBe(
      "roiUi.headline.same",
    );
    expect(headline(period({ cards: 2, costUsd: 5 }), period({ cards: 9, costUsd: 5 })).key).toBe(
      "roiUi.headline.fewer",
    );
    expect(headline(period({ cards: 0, costUsd: 6 }), period({ cards: 0, costUsd: 0 }))).toEqual({
      key: "roiUi.headline.none",
      vars: { cost: "6.00" },
    });
    expect(headline(period({ cards: 0, costUsd: 6 }), period({ cards: 3, costUsd: 3 })).key).toBe(
      "roiUi.headline.fewer",
    );
  });
});
