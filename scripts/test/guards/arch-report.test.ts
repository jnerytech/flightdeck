import { describe, expect, test } from "bun:test";
import {
  type ArchInputs,
  entryRows,
  formatEntries,
  formatTable,
  growing,
  isEntry,
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

describe("arch-report: narrow entries (#1624)", () => {
  const ENTRY = "apps/desktop/src/features/board/index.ts";
  const names = (count: number) =>
    `export { ${Array.from({ length: count }, (_, i) => `n${i}`).join(", ")} };\n`;

  test("an entry is a domain's index.ts under a package's src; a test file or another file is not", () => {
    expect(isEntry("apps/desktop/src/features/board/index.ts")).toBe(true);
    expect(isEntry("apps/daemon/src/sessions/index.ts")).toBe(true);
    expect(isEntry("packages/protocol/src/index.ts")).toBe(true);
    expect(isEntry("apps/desktop/src/features/board/board.ts")).toBe(false);
    expect(isEntry("apps/desktop/test/board/index.ts")).toBe(false);
    expect(isEntry("scripts/lib/index.ts")).toBe(false);
  });

  test("the export count of an entry counts every name it lists, whatever the form, and skips comments", () => {
    const text = [
      'export { a, b } from "./x.ts";',
      'export type { T, U as V } from "./y.ts";',
      "export {",
      "  c, // a note",
      "  d,",
      "};",
      "export const e = 1;",
      "export function f() {}",
      "export interface G {}",
      "export type H = string;",
      'export * as ns from "./z.ts";',
      "// export const nope = 1;",
      "/* export const alsoNope = 1; */",
    ].join("\n");
    expect(entryRows(new Map([[ENTRY, text]]), new Map())).toEqual([
      { entry: ENTRY, base: null, today: 11, broad: false },
    ]);
  });

  test("an entry with a bare export-star is reported as broad", () => {
    const rows = entryRows(new Map([[ENTRY, `${names(2)}export * from "./all.ts";\n`]]), new Map());
    expect(rows).toEqual([{ entry: ENTRY, base: null, today: 2, broad: true }]);
    expect(formatEntries(rows)).toContain("broad (export *)");
  });

  test("a growth over 20% in one PR is flagged; exactly 20%, a smaller growth, a shrink and a new entry are not", () => {
    const base = new Map([[ENTRY, names(5)]]);
    const flagged = (count: number) =>
      formatEntries(entryRows(new Map([[ENTRY, names(count)]]), base)).includes("grew");
    expect(flagged(7)).toBe(true);
    expect(flagged(6)).toBe(false);
    expect(flagged(5)).toBe(false);
    expect(flagged(3)).toBe(false);
    expect(formatEntries(entryRows(new Map([[ENTRY, names(9)]]), new Map()))).not.toContain("grew");
  });

  test("the table lists each entry with its count on main and today, sorted by path", () => {
    const rows = entryRows(
      new Map([
        ["packages/protocol/src/index.ts", names(3)],
        [ENTRY, names(7)],
      ]),
      new Map([[ENTRY, names(5)]]),
    );
    expect(formatEntries(rows).split("\n")).toEqual([
      "| Entry | On main | Today | Note |",
      "| --- | ---: | ---: | --- |",
      `| ${ENTRY} | 5 | 7 | grew 40% (over 20%) |`,
      "| packages/protocol/src/index.ts | - | 3 |  |",
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
