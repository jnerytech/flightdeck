import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runShard, type ShardMarker } from "../../lib/shard-gate.ts";
import type { Tier } from "../../lib/test-tiers.ts";
import { TIER_SHARDS } from "../../lib/tier-shards.ts";

const TIERS: Record<string, Tier> = {
  "u.test.ts": "unit",
  "c.test.tsx": "component",
  "i1.test.ts": "integration",
  "i2.test.ts": "integration",
};
const TRACKED = [...Object.keys(TIERS), "src/x.ts"];

/** A shard job's effects, recorded; the clock moves 2.5 s between the two reads. */
function fakes(selection?: { tests: string[]; targets: string[] }) {
  const written = new Map<string, string>();
  const spawned: string[][] = [];
  const clock = [1_000, 3_500];
  return {
    written,
    spawned,
    deps: {
      root: "/repo",
      tracked: TRACKED,
      timings: {},
      mkdir: () => {},
      write: (path: string, text: string) => written.set(path, text),
      spawn: async (argv: string[]) => {
        spawned.push(argv);
        return { exit: 0, log: " 4 pass\n 0 fail\nRan 4 tests across 2 files." };
      },
      print: () => {},
      tierOf: (path: string) => TIERS[path],
      now: () => clock.shift() ?? 0,
      ...(selection ? { selection } : {}),
    },
  };
}

const markerOf = (f: ReturnType<typeof fakes>): ShardMarker =>
  JSON.parse(f.written.get(join("/tmp/out", "marker.json")) ?? "{}");

describe("shard-gate run: a shard job runs one tier group (#1854)", () => {
  test("a unit + component shard runs those tests only, and its marker names the tier and the seconds", async () => {
    const f = fakes();
    expect(await runShard(`1/${TIER_SHARDS}`, "bun", "/tmp/out", f.deps)).toBe(0);
    const marker = markerOf(f);
    expect(marker.files).toHaveLength(1);
    expect(["unit", "component"]).toContain(TIERS[marker.files[0] ?? ""] ?? "");
    expect(marker.tier).toBe("unit + component 1/3");
    expect(marker.seconds).toBe(2.5);
    expect(marker.of).toBe(TIER_SHARDS);
  });

  test("an integration shard runs the integration tests only", async () => {
    const f = fakes();
    await runShard(`4/${TIER_SHARDS}`, "bun", "/tmp/out", f.deps);
    expect(markerOf(f).files.every((file) => TIERS[file] === "integration")).toBe(true);
    expect(markerOf(f).tier).toBe("integration 1/1");
  });

  test("a count that is not the tier plan's is refused before anything runs", async () => {
    const f = fakes();
    expect(await runShard("1/3", "bun", "/tmp/out", f.deps)).toBe(2);
    expect(f.spawned).toEqual([]);
  });

  test("a PR selection with no integration test leaves the integration shards empty and passing", async () => {
    const f = fakes({ tests: ["u.test.ts", "c.test.tsx"], targets: ["src/x.ts"] });
    expect(await runShard(`4/${TIER_SHARDS}`, "bun", "/tmp/out", f.deps)).toBe(0);
    expect(f.spawned).toEqual([]);
    expect(markerOf(f)).toMatchObject({ shard: 4, files: [], exit: 0, tier: "integration 1/1" });
  });
});

describe("shard-gate run: the fast baseline is instrumented in a PR's unit + component shards (#1854)", () => {
  const envOf = async (shard: number, extraTargets: string[]) => {
    const f = fakes({ tests: ["u.test.ts", "c.test.tsx", "i1.test.ts"], targets: ["src/x.ts"] });
    let env: Record<string, string> = {};
    const deps = {
      ...f.deps,
      extraTargets,
      spawn: async (_argv: string[], e: Record<string, string>) => {
        env = e;
        return { exit: 0, log: " 1 pass\n 0 fail\nRan 1 tests across 1 files." };
      },
    };
    await runShard(`${shard}/${TIER_SHARDS}`, "istanbul", "/tmp/out", deps);
    return JSON.parse(env.COVERAGE_FUNCS_FILES ?? "[]") as string[];
  };

  test("a unit + component shard instruments the changed sources and the baseline, so a settled count judges each baseline file", async () => {
    for (const shard of [1, 2, 3])
      expect(await envOf(shard, ["src/base.ts"])).toEqual(["src/x.ts", "src/base.ts"]);
  });

  test("an integration shard instruments only the changed sources", async () => {
    expect(await envOf(4, ["src/base.ts"])).toEqual(["src/x.ts"]);
  });
});
