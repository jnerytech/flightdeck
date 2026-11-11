/**
 * The suite's shards, named by tier (#1854). The test pyramid is explicit in the run: the first
 * shards hold the unit and component tests, the next the integration tests, so a job's name says
 * which tier it measures. A test's tier is computed from its content (#261), never from a folder.
 */
import { splitShards, type Timings } from "./test-shards.ts";
import type { Tier } from "./test-tiers.ts";

interface TierGroup {
  label: string;
  tiers: readonly Tier[];
  /** How many shard jobs share this group's test files. */
  shards: number;
}

/** In pyramid order: the base first. The e2e tier runs in its own jobs (the journeys, the smokes). */
export const TIER_GROUPS: readonly TierGroup[] = [
  { label: "unit + component", tiers: ["unit", "component"], shards: 2 },
  { label: "integration", tiers: ["integration"], shards: 2 },
];

/** The shard count of the whole plan: the shards `shard-gate` numbers 1 to this. */
export const TIER_SHARDS = TIER_GROUPS.reduce((sum, group) => sum + group.shards, 0);

/** The shard numbers (1-based) of the base of the pyramid: the first group's. */
export const FAST_SHARDS: readonly number[] = Array.from(
  { length: TIER_GROUPS[0]?.shards ?? 0 },
  (_, k) => k + 1,
);

/** Which group, and which part of it, shard `index` of `count` is; null off the plan. */
export function tierShard(
  index: number,
  count: number,
): { group: TierGroup; part: number; of: number } | null {
  if (count !== TIER_SHARDS || !Number.isInteger(index) || index < 1 || index > count) return null;
  let before = 0;
  for (const group of TIER_GROUPS) {
    if (index <= before + group.shards) return { group, part: index - before, of: group.shards };
    before += group.shards;
  }
  return null;
}

/**
 * The test files shard `index` runs: those of its group's tiers, split by the seconds each took.
 * A file whose tier is unknown counts as a unit test, so no file falls out of every shard.
 */
export function tierShardFiles(
  files: readonly string[],
  tierOf: (path: string) => Tier | undefined,
  timings: Timings,
  index: number,
  count: number,
): { group: TierGroup; files: string[] } | null {
  const at = tierShard(index, count);
  if (!at) return null;
  const mine = files.filter((file) => at.group.tiers.includes(tierOf(file) ?? "unit"));
  return { group: at.group, files: splitShards(mine, timings, at.of)[at.part - 1] ?? [] };
}
