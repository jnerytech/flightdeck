import type { Chunk } from "./perf-baseline.ts";

/**
 * The size the entry chunk may not pass (gzip, bytes). Phase 28 baseline: 516,263; the spec asks
 * for 30% less (361,384); the code split brought it to about 343,500. See DECISIONS.
 */
export const ENTRY_GZIP_LIMIT = 360_000;

/** What is wrong with the build's chunks against the budget; empty when it holds. */
export function overBudget(
  chunks: Chunk[],
  entry: string | null,
  limit = ENTRY_GZIP_LIMIT,
): string[] {
  const found = chunks.find((chunk) => chunk.file === entry);
  if (!found) return ["no entry chunk found in the build"];
  if (found.gzip <= limit) return [];
  const n = (value: number) => value.toLocaleString("en-US");
  return [`entry chunk ${found.file} is ${n(found.gzip)} bytes gzip, over the ${n(limit)} limit`];
}
