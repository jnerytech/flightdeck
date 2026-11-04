import { describe, expect, test } from "bun:test";
import type { RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { EMPTY_PERIOD } from "../src/lib/roi.ts";
import { humanTokens, personRows } from "../src/lib/roi-people.ts";
import type { Person } from "../src/lib/roi-settings.ts";

const person = (name: string, hostIds: string[], over: Partial<Person> = {}): Person => ({
  id: name,
  name,
  hostIds,
  tokenLimit: null,
  costLimit: null,
  ...over,
});

const answer = (
  hostId: string,
  projects: Array<Partial<RoiPeriod>>,
): { hostId: string; result: RoiSummaryResult } => ({
  hostId,
  result: {
    from: "2026-10-01",
    to: "2026-10-14",
    previousFrom: "2026-09-17",
    previousTo: "2026-09-30",
    projects: projects.map((current, i) => ({
      projectKey: `${hostId}-${i}`,
      name: `p${i}`,
      current: { ...EMPTY_PERIOD, ...current },
      previous: { ...EMPTY_PERIOD },
    })),
  },
});

describe("roi-pessoas-ui: the rows", () => {
  test("a person adds up what their hosts used and delivered, and the shares come from the limits", () => {
    const rows = personRows(
      [person("Ana", ["a", "b"], { tokenLimit: 5_000_000, costLimit: 50 })],
      [
        answer("a", [{ tokens: 2_000_000, costUsd: 10, cards: 4, prsMerged: 2 }]),
        answer("b", [
          { tokens: 1_100_000, costUsd: 5, cards: 3, prsMerged: 2 },
          { tokens: 0, costUsd: 5 },
        ]),
        answer("other", [{ tokens: 9_000_000, costUsd: 99, cards: 9 }]),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokens: 3_100_000,
      costUsd: 20,
      cards: 7,
      prsMerged: 4,
      tokenShare: 0.62,
      costShare: 0.4,
    });
    expect(rows[0]?.tokensPerCard).toBeCloseTo(442_857.14, 1);
  });

  test("no limit means no share, and no card done means no tokens per card", () => {
    const [row] = personRows([person("Bo", ["a"])], [answer("a", [{ tokens: 500, costUsd: 1 }])]);
    expect(row).toMatchObject({
      tokens: 500,
      tokenShare: null,
      costShare: null,
      tokensPerCard: null,
    });
  });

  test("a person whose hosts did not answer has zeros, and the order is by name, not delivery", () => {
    const rows = personRows(
      [person("Zed", ["a"]), person("Ana", ["gone"]), person("Mia", ["b"])],
      [answer("a", [{ tokens: 9, cards: 99 }]), answer("b", [{ tokens: 1, cards: 1 }])],
    );
    expect(rows.map((r) => [r.person.name, r.cards])).toEqual([
      ["Ana", 0],
      ["Mia", 1],
      ["Zed", 99],
    ]);
  });
});

describe("roi-pessoas-ui: reading a token count", () => {
  test("plain under a thousand, thousands, millions from a hundred thousand, trimmed to two decimals", () => {
    expect(humanTokens(0)).toEqual({ unit: "plain", value: "0" });
    expect(humanTokens(950)).toEqual({ unit: "plain", value: "950" });
    expect(humanTokens(1_000)).toEqual({ unit: "thousand", value: "1" });
    expect(humanTokens(12_340)).toEqual({ unit: "thousand", value: "12.34" });
    expect(humanTokens(99_999)).toEqual({ unit: "thousand", value: "100" });
    expect(humanTokens(100_000)).toEqual({ unit: "million", value: "0.1" });
    expect(humanTokens(442_857)).toEqual({ unit: "million", value: "0.44" });
    expect(humanTokens(3_100_000)).toEqual({ unit: "million", value: "3.1" });
    expect(humanTokens(5_000_000)).toEqual({ unit: "million", value: "5" });
  });
});
