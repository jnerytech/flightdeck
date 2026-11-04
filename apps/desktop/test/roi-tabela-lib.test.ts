import { describe, expect, test } from "bun:test";
import type { RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { EMPTY_PERIOD, figures, type RoiMoney } from "../src/lib/roi.ts";
import { csvOf, type RoiRow, rowsFrom, sortRows, totalsOf } from "../src/lib/roi-table.ts";

const period = (over: Partial<RoiPeriod>): RoiPeriod => ({ ...EMPTY_PERIOD, ...over });
const MONEY: RoiMoney = {
  rate: null,
  billed: null,
  planShareUsd: null,
  countReview: false,
  reviewCapSeconds: 300,
};
const WITH_RATE: RoiMoney = { ...MONEY, rate: 10 };

const summary = (
  projects: Array<{ projectKey: string; name: string; current: Partial<RoiPeriod> }>,
): RoiSummaryResult => ({
  from: "2026-10-01",
  to: "2026-10-14",
  previousFrom: "2026-09-17",
  previousTo: "2026-09-30",
  projects: projects.map((p) => ({
    projectKey: p.projectKey,
    name: p.name,
    current: period(p.current),
    previous: period({}),
  })),
});

const row = (key: string, name: string, over: Partial<RoiPeriod>, money = MONEY): RoiRow => ({
  key,
  name,
  figures: figures(period(over), money),
});

describe("roi-tabela-ui: the rows", () => {
  test("one row per project in the scope, a project on two hosts is one row", () => {
    const rows = rowsFrom({
      summaries: [
        {
          hostId: "a",
          result: summary([
            { projectKey: "k1", name: "shop", current: { costUsd: 4, cards: 1 } },
            { projectKey: "k2", name: "blog", current: { costUsd: 1 } },
          ]),
        },
        {
          hostId: "b",
          result: summary([{ projectKey: "k1", name: "shop", current: { costUsd: 6, cards: 2 } }]),
        },
      ],
      inScope: (k) => k !== "k2",
      moneyOf: () => WITH_RATE,
      nameOf: (_k, name) => `[${name}]`,
    });
    expect(rows.map((r) => [r.key, r.name, r.figures.costUsd, r.figures.cards])).toEqual([
      ["k1", "[shop]", 10, 3],
    ]);
  });

  test("each row uses the money of its own project", () => {
    const rows = rowsFrom({
      summaries: [
        {
          hostId: "a",
          result: summary([
            { projectKey: "k1", name: "a", current: { hours: 2 } },
            { projectKey: "k2", name: "b", current: { hours: 2 } },
          ]),
        },
      ],
      inScope: () => true,
      moneyOf: (k) => (k === "k1" ? WITH_RATE : MONEY),
      nameOf: (_k, name) => name,
    });
    expect(rows.map((r) => r.figures.valueUsd)).toEqual([20, null]);
  });
});

describe("roi-tabela-ui: sorting", () => {
  const rows = [
    row("a", "beta", { costUsd: 5, cards: 1, prsMerged: 1, hours: 1 }, WITH_RATE),
    row("b", "alpha", { costUsd: 9, cards: 3, prsMerged: 0, hours: 5 }, WITH_RATE),
    row("c", "gamma", { costUsd: 0, cards: 0 }),
  ];
  const names = (r: RoiRow[]) => r.map((x) => x.name);

  test("by name, both ways", () => {
    expect(names(sortRows(rows, "project", "asc"))).toEqual(["alpha", "beta", "gamma"]);
    expect(names(sortRows(rows, "project", "desc"))).toEqual(["gamma", "beta", "alpha"]);
  });

  test("by a number, both ways, and a figure that cannot be computed is last either way", () => {
    expect(names(sortRows(rows, "cost", "asc"))).toEqual(["gamma", "beta", "alpha"]);
    expect(names(sortRows(rows, "cost", "desc"))).toEqual(["alpha", "beta", "gamma"]);
    // gamma has no cards, so no cost per card: last in both directions.
    expect(names(sortRows(rows, "costPerCard", "asc"))).toEqual(["alpha", "beta", "gamma"]);
    expect(names(sortRows(rows, "costPerCard", "desc"))).toEqual(["beta", "alpha", "gamma"]);
  });

  test("every column sorts, and the input is left alone", () => {
    const before = names(rows);
    for (const column of ["cards", "prs", "costPerPr", "hours", "value", "roi"] as const) {
      expect(sortRows(rows, column, "asc")).toHaveLength(3);
    }
    expect(names(sortRows(rows, "prs", "desc"))).toEqual(["beta", "alpha", "gamma"]);
    expect(names(sortRows(rows, "hours", "desc"))).toEqual(["alpha", "beta", "gamma"]);
    expect(names(sortRows(rows, "value", "desc"))).toEqual(["alpha", "beta", "gamma"]);
    expect(names(sortRows(rows, "roi", "desc"))).toEqual(["alpha", "beta", "gamma"]);
    expect(names(rows)).toEqual(before);
  });
});

describe("roi-tabela-ui: the footer", () => {
  test("totals are the sum of the rows, and the ratios come from the totals", () => {
    const totals = totalsOf([
      row("a", "a", { costUsd: 4, cards: 2, prsMerged: 1, hours: 1 }, WITH_RATE),
      row("b", "b", { costUsd: 6, cards: 3, prsMerged: 1, hours: 4 }, WITH_RATE),
    ]);
    expect(totals).toEqual({
      costUsd: 10,
      cards: 5,
      prsMerged: 2,
      costPerCard: 2,
      costPerPr: 5,
      hours: 5,
      valueUsd: 50,
      roi: 4,
    });
  });

  test("without a value on any row there is none in the footer, and nothing divides by zero", () => {
    expect(totalsOf([row("a", "a", { costUsd: 0 })])).toEqual({
      costUsd: 0,
      cards: 0,
      prsMerged: 0,
      costPerCard: null,
      costPerPr: null,
      hours: 0,
      valueUsd: null,
      roi: null,
    });
    expect(totalsOf([])).toMatchObject({ costUsd: 0, valueUsd: null });
  });

  test("a value on some rows adds up the rows that have one", () => {
    const totals = totalsOf([
      row("a", "a", { costUsd: 1, hours: 2 }, WITH_RATE),
      row("b", "b", { costUsd: 1, hours: 9 }),
    ]);
    expect(totals.valueUsd).toBe(20);
  });
});

describe("roi-csv: the file", () => {
  const header = [
    "Project",
    "Cost",
    "Cards",
    "PRs",
    "Per card",
    "Per PR",
    "Hours",
    "Value",
    "ROI",
    "How",
  ];

  test("a header, one line per row, dots for decimals, empty where a figure cannot be computed", () => {
    const text = csvOf(
      [row("a", "shop", { costUsd: 12, cards: 3, prsMerged: 2, hours: 1.5 }, WITH_RATE)],
      header,
      () => "cost 12.00",
    );
    expect(text).toBe(
      [
        "Project,Cost,Cards,PRs,Per card,Per PR,Hours,Value,ROI,How",
        "shop,12.00,3,2,4.00,6.00,1.5,15.00,0.25,cost 12.00",
        "",
      ].join("\r\n"),
    );
    const bare = csvOf([row("b", "blog", { costUsd: 0 })], header, () => "");
    expect(bare.split("\r\n")[1]).toBe("blog,0.00,0,0,,,0,,,");
  });

  test("commas, quotes and line breaks are escaped", () => {
    const text = csvOf(
      [row("a", 'a, "b"\nc', { costUsd: 1 })],
      header,
      () => 'he said "x", then\ny',
    );
    expect(text).toContain('"a, ""b""\nc",1.00');
    expect(text.endsWith('"he said ""x"", then\ny"\r\n')).toBe(true);
  });
});
