import type { Tier } from "./test-tiers.ts";

export interface TierGroup {
  label: string;
  tiers: readonly Tier[];
  shards: number;
}

export const TIER_GROUPS: readonly TierGroup[] = [];
export const TIER_SHARDS = 0;

export function tierShard(
  _index: number,
  _count: number,
): { group: TierGroup; part: number; of: number } | null {
  return null;
}

export function tierShardFiles(
  _files: readonly string[],
  _tierOf: (path: string) => Tier | undefined,
  _timings: Record<string, number>,
  _index: number,
  _count: number,
): { group: TierGroup; files: string[] } | null {
  return null;
}
