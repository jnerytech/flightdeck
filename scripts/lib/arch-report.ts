/**
 * Issue #1610: one table of every structure ratchet, each baseline against today's count. The
 * ratchets themselves (dependency-cruiser, src-size, test-layout) stay where they are and still
 * fail on growth; this reads their baselines and prints them together, for the terminal, the CI
 * job summary and a JSON file to follow the trend.
 */
import { ruleCounts } from "./arch-ratchet.ts";

export type RatchetRow = { ratchet: string; baseline: number; today: number };

export type ArchInputs = {
  /** `.dependency-cruiser-known-violations.json` at the merge-base with main, and in the working copy. */
  knownBase: string | null;
  knownHead: string | null;
  /** The rules the head's `.dependency-cruiser.cjs` adds to main's (`newRules`); today is their first baseline (#1624). */
  newRules?: ReadonlySet<string>;
  /** Source files over the size limit today and in src-size-baseline.json. */
  srcOversized: Record<string, number>;
  srcBaseline: Record<string, number>;
  /** Flat test files per workspace today and in test-layout-baseline.json. */
  flatCounts: Record<string, number>;
  flatBaseline: Record<string, number>;
  /** Dead-code findings by kind today (knip) and in knip-baseline.json. */
  knipCounts: Record<string, number>;
  knipBaseline: Record<string, number>;
  /** Raw `JSON.parse` calls per source file today and in json-parse-baseline.json. */
  jsonParseCounts: Record<string, number>;
  jsonParseBaseline: Record<string, number>;
  /** The share of test files per upper tier today (integration, e2e), in basis points, and in test-shape-baseline.json. */
  shapeShares: Record<string, number>;
  shapeBaseline: Record<string, number>;
};

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** The share of the test files in the integration and e2e tiers (#1854), in basis points, rounded up. */
export function shapeShares(filesByTier: Record<string, number>): Record<string, number> {
  const total = sum(filesByTier);
  const share = (tier: string) =>
    total === 0 ? 0 : Math.ceil(((filesByTier[tier] ?? 0) * 10_000) / total);
  return { integration: share("integration"), e2e: share("e2e") };
}

/** One row per ratchet figure, sorted by name. */
export function ratchetRows(inputs: ArchInputs): RatchetRow[] {
  const rows: RatchetRow[] = [];
  if (inputs.knownBase !== null || inputs.knownHead !== null) {
    const head = ruleCounts(inputs.knownHead);
    // no file on main yet (arch-ratchet.ts agrees): today is the first baseline
    const base = inputs.knownBase === null ? head : ruleCounts(inputs.knownBase);
    for (const rule of new Set([...Object.keys(base), ...Object.keys(head)]))
      rows.push({
        ratchet: `depcruise ${rule}`,
        baseline: inputs.newRules?.has(rule) ? (head[rule] ?? 0) : (base[rule] ?? 0),
        today: head[rule] ?? 0,
      });
  }
  rows.push({
    ratchet: "src-size files over the limit",
    baseline: Object.keys(inputs.srcBaseline).length,
    today: Object.keys(inputs.srcOversized).length,
  });
  rows.push({
    ratchet: "json-parse raw calls",
    baseline: sum(inputs.jsonParseBaseline),
    today: sum(inputs.jsonParseCounts),
  });
  for (const tier of new Set([
    ...Object.keys(inputs.shapeBaseline),
    ...Object.keys(inputs.shapeShares),
  ]))
    rows.push({
      ratchet: `test-shape ${tier} share (basis points)`,
      baseline: inputs.shapeBaseline[tier] ?? 0,
      today: inputs.shapeShares[tier] ?? 0,
    });
  for (const kind of new Set([
    ...Object.keys(inputs.knipBaseline),
    ...Object.keys(inputs.knipCounts),
  ]))
    rows.push({
      ratchet: `knip ${kind}`,
      baseline: inputs.knipBaseline[kind] ?? 0,
      today: inputs.knipCounts[kind] ?? 0,
    });
  for (const workspace of new Set([
    ...Object.keys(inputs.flatBaseline),
    ...Object.keys(inputs.flatCounts),
  ]))
    rows.push({
      ratchet: `test-layout ${workspace}`,
      baseline: inputs.flatBaseline[workspace] ?? 0,
      today: inputs.flatCounts[workspace] ?? 0,
    });
  return rows.sort((a, b) => (a.ratchet < b.ratchet ? -1 : Number(a.ratchet > b.ratchet)));
}

/** The rows whose count is above its baseline. */
export function growing(rows: RatchetRow[]): RatchetRow[] {
  return rows.filter((row) => row.today > row.baseline);
}

/** A markdown table of the rows, with a status column (`ok`, `down` or `UP`). */
export function formatTable(rows: RatchetRow[]): string {
  const status = (row: RatchetRow) =>
    row.today > row.baseline ? "UP" : row.today < row.baseline ? "down" : "ok";
  return [
    "| Ratchet | Baseline | Today | Status |",
    "| --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.ratchet} | ${row.baseline} | ${row.today} | ${status(row)} |`),
  ].join("\n");
}

export type EntryRow = { entry: string; base: number | null; today: number; broad: boolean };

/** Growth of an entry's export count in one PR that gets flagged (#1624), as a share of its count on main. */
const ENTRY_GROWTH = 0.2;

/** Whether a tracked path is a domain's `index.ts` under a package's `src` (#1624). */
export function isEntry(path: string): boolean {
  return /^(?:apps|packages)\/[^/]+\/src\/(?:.*\/)?index\.ts$/.test(path);
}

/** The names an entry lists and whether it has a bare `export * from` (#1624); comments are skipped. */
function exportsOf(source: string): { count: number; broad: boolean } {
  const text = source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
  const listed = [...text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)].reduce(
    (sum, [, names]) => sum + (names ?? "").split(",").filter((name) => name.trim()).length,
    0,
  );
  const declared = text.match(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+\w+/gm,
  );
  const others = text.match(/^export\s*\*\s*as\s+\w+|^export\s+default\b/gm);
  return {
    count: listed + (declared?.length ?? 0) + (others?.length ?? 0),
    broad: /^export\s*\*\s*from/m.test(text),
  };
}

/** One row per entry in `today` (path to source text), against the same entry in `base`, sorted by path (#1624). */
export function entryRows(
  today: ReadonlyMap<string, string>,
  base: ReadonlyMap<string, string>,
): EntryRow[] {
  return [...today.entries()]
    .map(([entry, source]) => {
      const now = exportsOf(source);
      const before = base.get(entry);
      return {
        entry,
        base: before === undefined ? null : exportsOf(before).count,
        today: now.count,
        broad: now.broad,
      };
    })
    .sort((a, b) => (a.entry < b.entry ? -1 : Number(a.entry > b.entry)));
}

const entryNote = (row: EntryRow): string => {
  const notes = [];
  if (row.broad) notes.push("broad (export *)");
  if (row.base !== null && row.today > row.base * (1 + ENTRY_GROWTH))
    notes.push(
      `grew ${row.base === 0 ? "from 0" : `${Math.round(((row.today - row.base) / row.base) * 100)}%`} (over ${ENTRY_GROWTH * 100}%)`,
    );
  return notes.join("; ");
};

/** A markdown table of the entries with a note for a broad one and for a growth over 20% (#1624). */
export function formatEntries(rows: EntryRow[]): string {
  return [
    "| Entry | On main | Today | Note |",
    "| --- | ---: | ---: | --- |",
    ...rows.map(
      (row) => `| ${row.entry} | ${row.base ?? "-"} | ${row.today} | ${entryNote(row)} |`,
    ),
  ].join("\n");
}
