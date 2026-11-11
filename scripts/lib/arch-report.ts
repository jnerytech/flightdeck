/**
 * Issue #1610: one table of every structure ratchet, each baseline against today's count. The
 * ratchets themselves (dependency-cruiser, src-size, test-layout) stay where they are and still
 * fail on growth; this reads their baselines and prints them together, for the terminal, the CI
 * job summary and a JSON file to follow the trend.
 */

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
export function ratchetRows(_inputs: ArchInputs): RatchetRow[] {
  return [{ ratchet: "stub", baseline: -1, today: -1 }];
}

/** The rows whose count is above its baseline. */
export function growing(_rows: RatchetRow[]): RatchetRow[] {
  return [];
}

/** A markdown table of the rows, with a status column (`ok`, `down` or `UP`). */
export function formatTable(_rows: RatchetRow[]): string {
  return "";
}
