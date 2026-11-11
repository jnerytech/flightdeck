import type { ShardMarker } from "./shard-gate.ts";
import type { Tier } from "./test-tiers.ts";

export interface TierRow {
  tier: Tier;
  files: number;
  tests: number | null;
  seconds: number | null;
  slowest: { file: string; seconds: number } | null;
}

export interface Pyramid {
  rows: TierRow[];
  jobs: Array<{ name: string; seconds: number }>;
}

export function pyramidOf(
  _tiers: Record<string, Tier>,
  _jobs: ReadonlyArray<{ marker: ShardMarker | null; junit: string | null }>,
): Pyramid {
  return { rows: [], jobs: [] };
}

export function renderPyramid(_pyramid: Pyramid): string {
  return "";
}
