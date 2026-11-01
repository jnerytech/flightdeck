import type { Chunk } from "./perf-baseline.ts";

/**
 * The size the entry chunk may not pass (gzip, bytes). Phase 28 baseline: 516,263; the spec asks
 * for 30% less (361,384); the code split brought it to about 343,500. See DECISIONS.
 */
export const ENTRY_GZIP_LIMIT = 0;

/** What is wrong with the build's chunks against the budget; empty when it holds. */
export function overBudget(
  _chunks: Chunk[],
  _entry: string | null,
  _limit = ENTRY_GZIP_LIMIT,
): string[] {
  return ["?"];
}
