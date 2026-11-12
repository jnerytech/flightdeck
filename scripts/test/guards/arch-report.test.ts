import { describe, expect, test } from "bun:test";
import {
  type ArchInputs,
  formatTable,
  growing,
  type RatchetRow,
  ratchetRows,
  shapeShares,
} from "../../lib/arch-report.ts";

const known = (rules: Record<string, number>) =>
  JSON.stringify(
    Object.entries(rules).flatMap(([name, n]) =>
      Array.from({ length: n }, () => ({ rule: { name } })),
    ),
  );

const inputs = (over: Partial<ArchInputs> = {}): ArchInputs => ({
  knownBase: known({ "no-cycles": 4, "domain-index-only": 10 }),
  knownHead: known({ "no-cycles": 3, "domain-index-only": 10 }),
  srcOversized: { "apps/daemon/src/main.ts": 1100 },
  srcBaseline: { "apps/daemon/src/main.ts": 1202, "apps/daemon/src/board/board.ts": 835 },
  flatCounts: { "apps/desktop/test": 600, "packages/protocol/test": 23 },
  flatBaseline: { "apps/desktop/test": 680, "packages/protocol/test": 23 },
  knipCounts: { exports: 150, types: 100, files: 15 },
  knipBaseline: { exports: 160, types: 100, files: 15 },
  jsonParseCounts: { "apps/daemon/src/a.ts": 2, "apps/desktop/src/lib/b.ts": 1 },
  jsonParseBaseline: { "apps/daemon/src/a.ts": 3, "apps/desktop/src/lib/b.ts": 1, "apps/x.ts": 4 },
  shapeShares: { integration: 2380, e2e: 220 },
  shapeBaseline: { integration: 2390, e2e: 220 },
  ...over,
});

describe("arch-report (#1610)", () => {
  test("each ratchet gets a row: depcruise per rule, oversized sources, flat tests per workspace", () => {
    expect(ratchetRows(inputs())).toEqual([
      { ratchet: "depcruise domain-index-only", baseline: 10, today: 10 },
      { ratchet: "depcruise no-cycles", baseline: 4, today: 3 },
      { ratchet: "json-parse raw calls", baseline: 8, today: 3 },
      { ratchet: "knip exports", baseline: 160, today: 150 },
      { ratchet: "knip files", baseline: 15, today: 15 },
      { ratchet: "knip types", baseline: 100, today: 100 },
      { ratchet: "src-size files over the limit", baseline: 2, today: 1 },
      { ratchet: "test-layout apps/desktop/test", baseline: 680, today: 600 },
      { ratchet: "test-layout packages/protocol/test", baseline: 23, today: 23 },
      { ratchet: "test-shape e2e share (basis points)", baseline: 220, today: 220 },
      { ratchet: "test-shape integration share (basis points)", baseline: 2390, today: 2380 },
    ]);
  });

  test("with no known file on main yet, today is the first baseline; no known file at all gives no depcruise rows", () => {
    const rows = ratchetRows(inputs({ knownBase: null, knownHead: known({ "no-cycles": 2 }) }));
    expect(rows.filter((r) => r.ratchet.startsWith("depcruise"))).toEqual([
      { ratchet: "depcruise no-cycles", baseline: 2, today: 2 },
    ]);
    expect(
      ratchetRows(inputs({ knownBase: null, knownHead: null })).some((r) =>
        r.ratchet.startsWith("depcruise"),
      ),
    ).toBe(false);
  });

  test("a rule main does not declare yet is at its first baseline: today counts as the baseline (#1624)", () => {
    const rows = ratchetRows(
      inputs({
        knownBase: known({ "no-cycles": 4 }),
        knownHead: known({ "no-cycles": 4, "desktop-no-cycle": 5 }),
        newRules: new Set(["desktop-no-cycle"]),
      }),
    );
    expect(rows.filter((r) => r.ratchet.startsWith("depcruise"))).toEqual([
      { ratchet: "depcruise desktop-no-cycle", baseline: 5, today: 5 },
      { ratchet: "depcruise no-cycles", baseline: 4, today: 4 },
    ]);
    const old = ratchetRows(
      inputs({
        knownBase: known({ "no-cycles": 4 }),
        knownHead: known({ "no-cycles": 4, "shared-rule": 1 }),
        newRules: new Set(),
      }),
    );
    expect(growing(old)).toEqual([{ ratchet: "depcruise shared-rule", baseline: 0, today: 1 }]);
  });

  test("the desktop's files in an import cycle get a row; one more file puts it above its baseline (#1624)", () => {
    const row = (today: number) =>
      ratchetRows(inputs({ desktopCycles: { today, baseline: 120 } })).find((r) =>
        r.ratchet.startsWith("desktop-cycles"),
      );
    expect(row(118)).toEqual({
      ratchet: "desktop-cycles files in a cycle",
      baseline: 120,
      today: 118,
    });
    expect(growing([row(121) as RatchetRow])).toHaveLength(1);
    expect(ratchetRows(inputs()).some((r) => r.ratchet.startsWith("desktop-cycles"))).toBe(false);
  });

  test("a workspace flat today but absent from its baseline is a row with baseline 0", () => {
    const rows = ratchetRows(inputs({ flatCounts: { "apps/daemon/test": 1 }, flatBaseline: {} }));
    expect(rows.find((r) => r.ratchet === "test-layout apps/daemon/test")).toEqual({
      ratchet: "test-layout apps/daemon/test",
      baseline: 0,
      today: 1,
    });
  });

  test("a planted unused export puts the knip exports row above its baseline", () => {
    const rows = ratchetRows(inputs({ knipCounts: { exports: 161, types: 100, files: 15 } }));
    expect(growing(rows)).toEqual([{ ratchet: "knip exports", baseline: 160, today: 161 }]);
  });

  test("a knip kind new against the baseline is a row with baseline 0", () => {
    const rows = ratchetRows(inputs({ knipCounts: { dependencies: 1 }, knipBaseline: {} }));
    expect(rows.filter((r) => r.ratchet.startsWith("knip"))).toEqual([
      { ratchet: "knip dependencies", baseline: 0, today: 1 },
    ]);
  });

  test("only a row above its baseline is growing", () => {
    expect(
      growing([
        { ratchet: "a", baseline: 3, today: 3 },
        { ratchet: "b", baseline: 3, today: 2 },
        { ratchet: "c", baseline: 3, today: 4 },
      ]),
    ).toEqual([{ ratchet: "c", baseline: 3, today: 4 }]);
  });

  test("the table has a header, one line per row and a status for equal, lower and higher", () => {
    const table = formatTable([
      { ratchet: "a", baseline: 3, today: 3 },
      { ratchet: "b", baseline: 3, today: 2 },
      { ratchet: "c", baseline: 3, today: 4 },
    ]);
    expect(table.split("\n")).toEqual([
      "| Ratchet | Baseline | Today | Status |",
      "| --- | ---: | ---: | --- |",
      "| a | 3 | 3 | ok |",
      "| b | 3 | 2 | down |",
      "| c | 3 | 4 | UP |",
    ]);
  });
});

describe("test shape: the pyramid's upper tiers may not take a larger share of the test files (#1854)", () => {
  test("the share of integration and e2e files, in basis points, rounded up", () => {
    expect(shapeShares({ unit: 700, component: 500, integration: 400, e2e: 100 })).toEqual({
      integration: 2353,
      e2e: 589,
    });
  });

  test("a tree with no test file has no share, not a division by zero", () => {
    expect(shapeShares({})).toEqual({ integration: 0, e2e: 0 });
  });

  test("a planted integration test with no unit test beside it puts the integration row above its baseline", () => {
    const rows = ratchetRows(inputs({ shapeShares: { integration: 2391, e2e: 220 } }));
    expect(growing(rows)).toEqual([
      { ratchet: "test-shape integration share (basis points)", baseline: 2390, today: 2391 },
    ]);
  });
});
