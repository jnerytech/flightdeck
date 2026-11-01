import { describe, expect, test } from "bun:test";
import { evaluateClientBudgets } from "../src/lib/client-budgets.ts";

const MONTH = "2026-10";
const run = (
  spent: Record<string, number>,
  announced: Record<string, number[]> = {},
  limits: Record<string, number> = { acme: 100, beta: 50 },
  month = MONTH,
) => evaluateClientBudgets({ month, limits, spent, announced });

describe("clients-budgets: a month limit on the roll-up", () => {
  test("each budget shows what was spent against its limit, and the thresholds reached", () => {
    const { states } = run({ acme: 82, beta: 10 });
    expect(states).toEqual([
      { clientId: "acme", limitUsd: 100, spentUsd: 82, fraction: 0.82, crossed: [0.5, 0.8] },
      { clientId: "beta", limitUsd: 50, spentUsd: 10, fraction: 0.2, crossed: [] },
    ]);
  });

  test("a client with no spend yet is at zero, and one over the limit has crossed all three", () => {
    const { states } = run({ beta: 80 });
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({ clientId: "acme", spentUsd: 0, fraction: 0, crossed: [] });
    expect(states[1]).toMatchObject({ clientId: "beta", fraction: 1.6, crossed: [0.5, 0.8, 1] });
  });

  test("the first time a threshold is reached it is news, with the highest one remembered", () => {
    const first = run({ acme: 82 });
    expect(first.news).toEqual([
      { clientId: "acme", threshold: 0.5 },
      { clientId: "acme", threshold: 0.8 },
    ]);
    expect(first.announced).toEqual({ [`acme|${MONTH}`]: [0.5, 0.8] });
  });

  test("a threshold that was announced is not news again, only the ones above it", () => {
    const again = run({ acme: 82 }, { [`acme|${MONTH}`]: [0.5, 0.8] });
    expect(again.news).toEqual([]);
    const later = run({ acme: 120 }, again.announced);
    expect(later.news).toEqual([{ clientId: "acme", threshold: 1 }]);
    expect(later.announced).toEqual({ [`acme|${MONTH}`]: [0.5, 0.8, 1] });
  });

  test("a new month announces again, and what was kept for the old one is dropped", () => {
    const old = { [`acme|${MONTH}`]: [0.5, 0.8, 1] };
    const next = run({ acme: 60 }, old, { acme: 100 }, "2026-11");
    expect(next.news).toEqual([{ clientId: "acme", threshold: 0.5 }]);
    expect(next.announced).toEqual({ "acme|2026-11": [0.5] });
  });

  test("a client whose budget was removed is not kept in what was announced", () => {
    const kept = run({ acme: 60 }, { [`ghost|${MONTH}`]: [1], [`beta|${MONTH}`]: [0.5] });
    expect(Object.keys(kept.announced).sort()).toEqual([`acme|${MONTH}`]);
  });
});
