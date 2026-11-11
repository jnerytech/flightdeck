import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mergeShards, type ShardMarker } from "../../lib/shard-gate.ts";
import type { Tier } from "../../lib/test-tiers.ts";

// The fast-coverage ratchet reads the unit + component shards' own coverage (#1854): those tests
// no longer run a third time just to get a lcov of the base of the pyramid.

const TIERS: Record<string, Tier> = {
  "u.test.ts": "unit",
  "c.test.tsx": "component",
  "u2.test.ts": "unit",
  "i1.test.ts": "integration",
  "i2.test.ts": "integration",
};
const TESTS = Object.keys(TIERS);
const SOURCES = ["src/a.ts", "src/b.ts"];

/** One file's lcov record: all its lines and its one function hit or not. */
const record = (path: string, hit: boolean) =>
  `SF:${path}\nFNF:1\nFNH:${hit ? 1 : 0}\nDA:1,${hit ? 1 : 0}\nDA:2,${hit ? 1 : 0}\nLF:2\nLH:${hit ? 2 : 0}\nend_of_record\n`;
/** The istanbul counters of the same file: one function `f` on line 1. */
const counters = (calls: number) => ({ fnMap: { "0": { name: "f", line: 1 } }, f: { "0": calls } });

interface Cover {
  [path: string]: boolean;
}
/** The shard `n` of the tier plan: its tests, and which sources it covers. */
const SHARDS: Array<{ files: string[]; covers: Cover }> = [
  { files: ["u.test.ts"], covers: { "src/a.ts": true, "src/b.ts": false } },
  { files: ["c.test.tsx"], covers: { "src/a.ts": true, "src/b.ts": false } },
  { files: ["u2.test.ts"], covers: { "src/a.ts": true, "src/b.ts": false } },
  { files: ["i1.test.ts", "i2.test.ts"], covers: { "src/a.ts": false, "src/b.ts": true } },
];

function run(baseline: string[], drop?: { shard: number; kind: "bun" | "istanbul" }) {
  const files = new Map<string, string>();
  const folders: string[] = [];
  SHARDS.forEach((shard, k) => {
    for (const kind of ["bun", "istanbul"] as const) {
      if (drop?.shard === k + 1 && drop.kind === kind) continue;
      const name = `${kind}-${k + 1}`;
      folders.push(name);
      const marker: ShardMarker = {
        shard: k + 1,
        of: 4,
        kind,
        files: shard.files,
        exit: 0,
        fail: 0,
      };
      files.set(join("/art", name, "marker.json"), JSON.stringify(marker));
      if (kind === "bun") {
        files.set(
          join("/art", name, "lcov.info"),
          SOURCES.map((s) => record(s, shard.covers[s] === true)).join(""),
        );
      } else {
        files.set(
          join("/art", name, "funcs.json"),
          JSON.stringify(
            Object.fromEntries(SOURCES.map((s) => [s, counters(shard.covers[s] === true ? 1 : 0)])),
          ),
        );
      }
    }
  });
  const results: Array<{ ok: boolean; lines: string[] }> = [];
  const code = mergeShards("/art", 4, "/out/lcov.info", {
    folders: () => folders,
    read: (path) => files.get(path) ?? null,
    write: () => {},
    tracked: TESTS,
    sources: SOURCES,
    print: () => {},
    error: () => {},
    tiers: TIERS,
    fastBaseline: baseline,
    fastResult: (result) => results.push(result),
  });
  return { code, results };
}

describe("shard-gate merge: the fast-coverage ratchet reads the unit + component shards (#1854)", () => {
  test("a listed source the base of the pyramid still covers holds, and the integration shards do not count", () => {
    const { results } = run(["src/a.ts"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.lines.join("\n")).toContain(
      "1 of 2 source(s) at the gate from the fast tiers",
    );
  });

  test("a listed source only the integration shards cover has dropped from the base: the ratchet fails and names it", () => {
    const { results } = run(["src/a.ts", "src/b.ts"]);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.lines.join("\n")).toContain("src/b.ts");
  });

  test("a unit + component shard that is missing leaves the ratchet with no verdict, never a pass", () => {
    const { results } = run(["src/a.ts"], { shard: 2, kind: "bun" });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.lines.join("\n")).toContain("no verdict");
  });

  test("the ratchet is reported while the merged gate keeps its own verdict", () => {
    expect(run(["src/a.ts"]).code).toBe(0);
  });
});
