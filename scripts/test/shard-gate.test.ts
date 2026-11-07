import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FunctionCoverage } from "../lib/coverage-funcs.ts";
import {
  failedCount,
  type GateInput,
  istanbulTargets,
  type ShardJob,
  type ShardMarker,
  shardGate,
  shardRun,
} from "../lib/shard-gate.ts";

/** One file's record as Bun writes it: function counts, then one DA line per executable line. */
const record = (path: string, fn: [number, number], lines: Array<[number, number]>) =>
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
const functions = (calls: number[]): FunctionCoverage => ({
  fnMap: Object.fromEntries(calls.map((_, i) => [String(i), { name: `f${i + 1}`, line: i + 1 }])),
  f: Object.fromEntries(calls.map((n, i) => [String(i), n])),
});

const TESTS = ["t1.test.ts", "t2.test.ts", "t3.test.ts"];
const marker = (shard: number, kind: "bun" | "istanbul", over: Partial<ShardMarker> = {}) => ({
  shard,
  of: 3,
  kind,
  files: [TESTS[shard - 1] as string],
  exit: 0,
  fail: 0,
  ...over,
});
const bun = (shard: number, lcov: string, over: Partial<ShardMarker> = {}): ShardJob => ({
  marker: marker(shard, "bun", over),
  data: lcov,
});
const ist = (
  shard: number,
  maps: Record<string, FunctionCoverage>,
  over: Partial<ShardMarker> = {},
): ShardJob => ({ marker: marker(shard, "istanbul", over), data: JSON.stringify(maps) });

/** Three shards that each load a.ts; the first calls f1 and runs line 1, the third f2 and line 2. */
function healthy(): ShardJob[] {
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
const gate = (jobs: ShardJob[], over: Partial<GateInput> = {}) =>
  shardGate({ shards: 3, tests: TESTS, jobs, sources: ["a.ts"], ...over });

describe("shard-gate: the merged 100% gate (#296)", () => {
  test("a line or a function covered in any one shard is covered, and the merged lcov holds the union", () => {
    const result = gate(healthy());
    expect(result.problems).toEqual([]);
    expect(result.lcov).toBe(
      `${record(
        "a.ts",
        [1, 2],
        [
          [1, 1],
          [2, 3],
        ],
      )}\n`,
    );
  });

  test("a line no shard ran and a function no shard called are named as check-coverage.ts names them", () => {
    const jobs = healthy();
    jobs[2] = bun(
      3,
      record(
        "a.ts",
        [0, 2],
        [
          [1, 0],
          [2, 0],
        ],
      ),
    );
    jobs[5] = ist(3, { "a.ts": functions([0, 0]) });
    expect(gate(jobs).problems).toEqual(["a.ts: funções 1/2, linhas 1/2"]);
  });

  test("every loaded file counts, as Bun's threshold counts it, and a source no shard loads is named", () => {
    const jobs = healthy();
    jobs[0] = bun(
      1,
      `${record(
        "a.ts",
        [1, 2],
        [
          [1, 1],
          [2, 0],
        ],
      )}\n${record("scripts/entry.ts", [0, 0], [[4, 0]])}`,
    );
    expect(gate(jobs, { sources: ["a.ts", "b.ts"] }).problems).toEqual([
      "b.ts: nenhum teste carrega este arquivo",
      "scripts/entry.ts: funções 0/0, linhas 0/1",
    ]);
  });

  test("a file istanbul did not instrument falls back to Bun's counts, and counts that cannot settle it fail", () => {
    const md = (shard: number, fn: [number, number]) =>
      `${record(
        "a.ts",
        [1, 2],
        [
          [1, 1],
          [2, 1],
        ],
      )}\n${record("pack.md", fn, [[1, 1]])}`;
    const run = (counts: Array<[number, number]>) => {
      const jobs = healthy();
      counts.forEach((fn, i) => {
        jobs[i] = bun(i + 1, md(i + 1, fn));
      });
      return gate(jobs).problems;
    };
    expect(
      run([
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toEqual([]);
    expect(
      run([
        [2, 2],
        [0, 2],
        [1, 2],
      ]),
    ).toEqual([]);
    expect(
      run([
        [0, 3],
        [1, 3],
        [1, 3],
      ]),
    ).toEqual(["pack.md: funções 1/3, linhas 1/1"]);
    expect(
      run([
        [1, 2],
        [1, 2],
        [0, 2],
      ]),
    ).toEqual([
      "pack.md: the shards' function counts cannot tell whether every function ran; run the suite whole",
    ]);
  });

  test("shards that disagree on a file's lines or functions never pass", () => {
    const lines = healthy();
    lines[1] = bun(
      2,
      record(
        "a.ts",
        [0, 2],
        [
          [1, 0],
          [3, 0],
        ],
      ),
    );
    expect(gate(lines).problems).toEqual([
      "a.ts: the shards disagree on its lines; run the suite whole",
    ]);
    const fns = healthy();
    fns[4] = ist(2, { "a.ts": functions([0, 0, 0]) });
    expect(gate(fns).problems).toEqual([
      "a.ts: the shards disagree on its functions; run the suite whole",
    ]);
  });
});

describe("shard-gate fails closed: a merged report missing a shard never reads as 100% (#296)", () => {
  const closed = (jobs: ShardJob[], over: Partial<GateInput> = {}) => {
    const result = gate(jobs, over);
    expect(result.lcov).toBe("");
    return result.problems;
  };

  test("a missing, cancelled or doubled shard job", () => {
    expect(closed(healthy().filter((_, i) => i !== 4))).toEqual(["shard 2/3 istanbul: missing"]);
    expect(closed(healthy().filter((_, i) => i !== 0))).toEqual([
      "shard 1/3 bun: missing",
      "1 test file(s) ran in no shard: t1.test.ts",
    ]);
    expect(closed([...healthy(), healthy()[2] as ShardJob])).toEqual(["shard 3/3 bun: doubled"]);
    // A job that was cancelled leaves its marker but no data, or no marker at all.
    const cancelled = healthy();
    cancelled[5] = { marker: marker(3, "istanbul"), data: null };
    expect(closed(cancelled)).toEqual(["shard 3/3 istanbul: no report"]);
    expect(closed([...healthy(), { marker: null, data: "SF:x" }])).toEqual([
      "a shard job left a report with no marker",
    ]);
  });

  test("a shard whose tests failed, or that is not one of the 3", () => {
    const failed = healthy();
    failed[3] = ist(1, { "a.ts": functions([1, 0]) }, { exit: 1, fail: 2 });
    expect(closed(failed)).toEqual(["shard 1/3 istanbul: its tests failed (exit 1, 2 failed)"]);
    const stray = healthy();
    stray[1] = bun(
      2,
      record(
        "a.ts",
        [0, 2],
        [
          [1, 0],
          [2, 0],
        ],
      ),
      { of: 4 },
    );
    expect(closed(stray)).toEqual([
      "shard 2/4 bun: not one of the 3 shards",
      "shard 2/3 bun: missing",
      "1 test file(s) ran in no shard: t2.test.ts",
    ]);
  });

  test("shards that do not run the suite's test files exactly once each", () => {
    const short = healthy();
    short[2] = bun(
      3,
      record(
        "a.ts",
        [1, 2],
        [
          [1, 0],
          [2, 3],
        ],
      ),
      { files: [] },
    );
    short[5] = ist(3, { "a.ts": functions([0, 2]) }, { files: [] });
    expect(closed(short)).toEqual(["1 test file(s) ran in no shard: t3.test.ts"]);
    const apart = healthy();
    apart[5] = ist(3, { "a.ts": functions([0, 2]) }, { files: ["t1.test.ts"] });
    expect(closed(apart)).toEqual([
      "shard 3/3: the bun and istanbul jobs ran different test files",
    ]);
    const twice = healthy();
    twice[1] = bun(
      2,
      record(
        "a.ts",
        [0, 2],
        [
          [1, 0],
          [2, 0],
        ],
      ),
      { files: ["t2.test.ts", "t1.test.ts"] },
    );
    twice[4] = ist(2, { "a.ts": functions([0, 0]) }, { files: ["t2.test.ts", "t1.test.ts"] });
    expect(closed(twice)).toEqual(["1 test file(s) ran in more than one shard: t1.test.ts"]);
  });

  test("a report that does not parse", () => {
    const broken = healthy();
    broken[3] = { marker: marker(1, "istanbul"), data: "{ nope" };
    expect(closed(broken)).toEqual(["shard 1/3 istanbul: its report does not parse"]);
  });
});

describe("shard-gate: how a shard job runs (#296)", () => {
  test("the bun job writes its lcov with the related config, which has no threshold", () => {
    expect(shardRun("bun", ["a.test.ts", "b.test.ts"], "out", ["x.ts"])).toEqual({
      argv: [
        "bun",
        "--config=bunfig.related.toml",
        "test",
        "--timeout=15000",
        "--coverage-dir=out",
        "./a.test.ts",
        "./b.test.ts",
      ],
      env: {},
    });
  });

  test("the istanbul job loads its preload first and writes the counters of the files it names", () => {
    expect(shardRun("istanbul", ["a.test.ts"], "out", ["x.ts", "y.tsx"])).toEqual({
      argv: ["bun", "--config=bunfig.shard.toml", "test", "--timeout=15000", "./a.test.ts"],
      env: { COVERAGE_FUNCS_FILES: '["x.ts","y.tsx"]', COVERAGE_FUNCS_OUT: "out/funcs.json" },
    });
  });

  test("istanbul instruments every tracked source the full gate counts: no test, helper, vendor UI or declaration", () => {
    expect(
      istanbulTargets([
        "apps/daemon/src/a.ts",
        "apps/daemon/src/bin.ts",
        "apps/desktop/src/App.tsx",
        "apps/desktop/src/components/ui/button.tsx",
        "apps/daemon/test/a.test.ts",
        "scripts/test/helper.ts",
        "scripts/demo.ts",
        "scripts/demo-seed.ts",
        "packages/protocol/src/env.d.ts",
        "docs/notes.md",
      ]),
    ).toEqual([
      "apps/daemon/src/a.ts",
      "apps/daemon/src/bin.ts",
      "apps/desktop/src/App.tsx",
      "scripts/demo.ts",
    ]);
  });

  test("the failed count comes from bun's summary, and a log with none reads as 0", () => {
    expect(failedCount(" 3324 pass\n 5 skip\n 2 fail\n")).toBe(2);
    expect(failedCount("crashed before the summary")).toBe(0);
  });

  test("bunfig.shard.toml is bunfig.related.toml with istanbul's preload first and Bun's coverage off", () => {
    type Config = { test: Record<string, unknown> };
    const related = Bun.TOML.parse(readFileSync("bunfig.related.toml", "utf8")) as Config;
    const shard = Bun.TOML.parse(readFileSync("bunfig.shard.toml", "utf8")) as Config;
    expect(shard.test).toEqual({
      ...related.test,
      preload: ["./scripts/test/coverage-funcs-preload.ts", ...(related.test.preload as string[])],
      coverage: false,
    });
  });
});
