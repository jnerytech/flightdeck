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
  /** Source files over the size limit today and in src-size-baseline.json. */
  srcOversized: Record<string, number>;
  srcBaseline: Record<string, number>;
  /** Flat test files per workspace today and in test-layout-baseline.json. */
  flatCounts: Record<string, number>;
  flatBaseline: Record<string, number>;
};

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
        baseline: base[rule] ?? 0,
        today: head[rule] ?? 0,
      });
  }
  rows.push({
    ratchet: "src-size files over the limit",
    baseline: Object.keys(inputs.srcBaseline).length,
    today: Object.keys(inputs.srcOversized).length,
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
