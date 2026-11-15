import type { FunctionCoverage } from "../../lib/coverage-gate/funcs.ts";
import {
  type GateInput,
  type ShardJob,
  type ShardMarker,
  shardGate,
} from "../../lib/tests/shard-gate.ts";

/** One file's record as Bun writes it: function counts, then one DA line per executable line. */
export const record = (path: string, fn: [number, number], lines: Array<[number, number]>) =>
  [
    `SF:${path}`,
    `FNF:${fn[1]}`,
    `FNH:${fn[0]}`,
    ...lines.map(([at, hits]) => `DA:${at},${hits}`),
    `LF:${lines.length}`,
    `LH:${lines.filter(([, hits]) => hits > 0).length}`,
    "end_of_record",
  ].join("\n");

/** Istanbul's counters for a file whose functions are named f1, f2...; `calls` per function. */
export const functions = (calls: number[]): FunctionCoverage => ({
  fnMap: Object.fromEntries(calls.map((_, i) => [String(i), { name: `f${i + 1}`, line: i + 1 }])),
  f: Object.fromEntries(calls.map((n, i) => [String(i), n])),
});

export const TESTS = ["t1.test.ts", "t2.test.ts", "t3.test.ts"];
export const marker = (
  shard: number,
  kind: "bun" | "istanbul",
  over: Partial<ShardMarker> = {},
) => ({
  shard,
  of: 3,
  kind,
  files: [TESTS[shard - 1] as string],
  exit: 0,
  fail: 0,
  ...over,
});
export const bun = (shard: number, lcov: string, over: Partial<ShardMarker> = {}): ShardJob => ({
  marker: marker(shard, "bun", over),
  data: lcov,
});
export const ist = (
  shard: number,
  maps: Record<string, FunctionCoverage>,
  over: Partial<ShardMarker> = {},
): ShardJob => ({ marker: marker(shard, "istanbul", over), data: JSON.stringify(maps) });

/** Three shards that each load a.ts; the first calls f1 and runs line 1, the third f2 and line 2. */
export function healthy(): ShardJob[] {
  return [
    bun(
      1,
      record(
        "a.ts",
        [1, 2],
        [
          [1, 1],
          [2, 0],
        ],
      ),
    ),
    bun(
      2,
      record(
        "a.ts",
        [0, 2],
        [
          [1, 0],
          [2, 0],
        ],
      ),
    ),
    bun(
      3,
      record(
        "a.ts",
        [1, 2],
        [
          [1, 0],
          [2, 3],
        ],
      ),
    ),
    ist(1, { "a.ts": functions([1, 0]) }),
    ist(2, { "a.ts": functions([0, 0]) }),
    ist(3, { "a.ts": functions([0, 2]) }),
  ];
}
export const gate = (jobs: ShardJob[], over: Partial<GateInput> = {}) =>
  shardGate({ shards: 3, tests: TESTS, jobs, sources: ["a.ts"], ...over });
