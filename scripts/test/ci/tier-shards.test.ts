import { describe, expect, test } from "bun:test";
import type { Tier } from "../../lib/test-tiers.ts";
import { FAST_SHARDS, TIER_GROUPS, TIER_SHARDS, tierShard, tierShardFiles } from "../../lib/tier-shards.ts";

const TIERS: Record<string, Tier> = {
  "a/unit-1.test.ts": "unit",
  "a/unit-2.test.ts": "unit",
  "a/comp-1.test.tsx": "component",
  "a/comp-2.test.tsx": "component",
  "b/int-1.test.ts": "integration",
  "b/int-2.test.ts": "integration",
  "b/int-3.test.ts": "integration",
};
const FILES = Object.keys(TIERS);
const TIMINGS = Object.fromEntries(FILES.map((file, i) => [file, i + 1]));
const tierOf = (path: string) => TIERS[path];

const filesOf = (index: number, tiers = tierOf) =>
  tierShardFiles(FILES, tiers, TIMINGS, index, TIER_SHARDS)?.files ?? [];

describe("tier shards: a PR's integration tests are few, so the base of the pyramid gets the runners (#1854)", () => {
  test("three shards run the unit + component base and one the integration tier", () => {
    expect(TIER_GROUPS.map((group) => group.shards)).toEqual([3, 1]);
    expect(FAST_SHARDS).toEqual([1, 2, 3]);
    expect(TIER_SHARDS).toBe(4);
  });
});

describe("tier shards: the suite's shards are named by tier, in pyramid order (#1854)", () => {
  test("the plan holds unit + component first, then integration, and its shards add up", () => {
    expect(TIER_GROUPS.map((group) => group.label)).toEqual(["unit + component", "integration"]);
    expect(TIER_SHARDS).toBe(TIER_GROUPS.reduce((sum, group) => sum + group.shards, 0));
  });

  test("a shard says which tier group and which part of it it is", () => {
    const parts = Array.from({ length: TIER_SHARDS }, (_, k) => tierShard(k + 1, TIER_SHARDS));
    expect(parts.map((p) => `${p?.group.label} ${p?.part}/${p?.of}`)).toEqual([
      "unit + component 1/3",
      "unit + component 2/3",
      "unit + component 3/3",
      "integration 1/1",
    ]);
  });

  test("a shard that is not one of the plan's, or a count that is not its total, has no tier", () => {
    expect(tierShard(0, TIER_SHARDS)).toBeNull();
    expect(tierShard(TIER_SHARDS + 1, TIER_SHARDS)).toBeNull();
    expect(tierShard(1, 3)).toBeNull();
  });

  test("each shard runs only its own tiers, and together they run every test file once", () => {
    const ran = Array.from({ length: TIER_SHARDS }, (_, k) => filesOf(k + 1));
    const light = ran.slice(0, 3).flat();
    expect(light.map((f) => TIERS[f]).every((t) => t === "unit" || t === "component")).toBe(true);
    const heavy = ran.slice(3).flat();
    expect(heavy.map((f) => TIERS[f]).every((t) => t === "integration")).toBe(true);
    expect(ran.flat().sort()).toEqual([...FILES].sort());
  });

  test("a test file whose tier is unknown runs with the unit tests, never in no shard", () => {
    const unknown = (path: string) => (path === "b/int-1.test.ts" ? undefined : TIERS[path]);
    const light = [1, 2, 3].flatMap((k) => filesOf(k, unknown));
    expect(light).toContain("b/int-1.test.ts");
    const all = Array.from({ length: TIER_SHARDS }, (_, k) => filesOf(k + 1, unknown)).flat();
    expect(all.sort()).toEqual([...FILES].sort());
  });

  test("a selection with no file of a tier leaves that tier's shards empty, not failing", () => {
    const only = FILES.filter((f) => TIERS[f] === "unit");
    const empty = tierShardFiles(only, tierOf, TIMINGS, 4, TIER_SHARDS);
    expect(empty?.files).toEqual([]);
    expect(empty?.group.label).toBe("integration");
  });
});
