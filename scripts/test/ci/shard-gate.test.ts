import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FunctionCoverage } from "../../lib/coverage-gate/funcs.ts";
import {
  failedCount,
  type GateInput,
  istanbulTargets,
  mergeShards,
  runShard,
  type ShardJob,
  type ShardMarker,
  selectionOf,
  shardGate,
  shardRun,
} from "../../lib/tests/shard-gate.ts";
import { importsOf } from "../../lib/tests/test-related.ts";

// repo-wide (#1108): reads the tracked file list, so CI's quick job runs it on every PR.

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

describe("shard-gate: the merged 80% gate (#296, #1002)", () => {
  test("a line or a function covered in any one shard is covered, and the merged lcov holds the union", () => {
    const result = gate(healthy());
    expect(result.problems).toEqual([]);
    expect(result.closed).toBe(false);
    // The function counts are the merge of the istanbul maps (f1 in shard 1, f2 in shard 3: both
    // called), not Bun's, which count what each shard loaded (#2019).
    expect(result.lcov).toBe(
      `${record(
        "a.ts",
        [2, 2],
        [
          [1, 1],
          [2, 3],
        ],
      )}\n`,
    );
  });

  test("the merged lcov never has more functions hit than found, even when Bun's counts differ between shards (#2019)", () => {
    const jobs = healthy();
    // Shard 2 counted 5 functions in a.ts, all called: its Bun count is not the file's.
    jobs[1] = bun(
      2,
      record(
        "a.ts",
        [5, 5],
        [
          [1, 0],
          [2, 0],
        ],
      ),
    );
    const lcov = gate(jobs).lcov;
    const [found, hit] = ["FNF", "FNH"].map((key) =>
      Number(new RegExp(`${key}:(\\d+)`).exec(lcov)?.[1]),
    );
    expect([hit, found]).toEqual([2, 2]);
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
    // #1011 review: the best shard alone already reaches the 80% gate, so no count is in doubt.
    expect(
      run([
        [4, 5],
        [4, 5],
        [0, 5],
      ]),
    ).toEqual([]);
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
    // The same ids, but another function on another line (#828 review): not one file either.
    const renamed = healthy();
    const moved = functions([0, 0]);
    moved.fnMap["1"] = { name: "other", line: 9 };
    renamed[4] = ist(2, { "a.ts": moved });
    expect(gate(renamed).problems).toEqual([
      "a.ts: the shards disagree on its functions; run the suite whole",
    ]);
  });
});

describe("shard-gate fails closed: a merged report missing a shard never reads as passing (#296)", () => {
  const closed = (jobs: ShardJob[], over: Partial<GateInput> = {}) => {
    const result = gate(jobs, over);
    expect(result.lcov).toBe("");
    expect(result.closed).toBe(true);
    return result.problems;
  };

  test("a long list of test files that ran in no shard names 10, then counts the rest", () => {
    const tests = Array.from({ length: 13 }, (_, i) => `t${i + 1}.test.ts`);
    expect(closed(healthy(), { tests: [...TESTS, ...tests.slice(3)] })).toEqual([
      "10 test file(s) ran in no shard: t4.test.ts, t5.test.ts, t6.test.ts, t7.test.ts, t8.test.ts, t9.test.ts, t10.test.ts, t11.test.ts, t12.test.ts, t13.test.ts",
    ]);
    expect(closed(healthy(), { tests: [...TESTS, ...tests.slice(3), "t14.test.ts"] })).toEqual([
      "11 test file(s) ran in no shard: t4.test.ts, t5.test.ts, t6.test.ts, t7.test.ts, t8.test.ts, t9.test.ts, t10.test.ts, t11.test.ts, t12.test.ts, t13.test.ts and 1 more",
    ]);
  });

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
  test("the bun job writes its lcov with the related config, which has no threshold, and its JUnit times (#1003)", () => {
    expect(shardRun("bun", ["a.test.ts", "b.test.ts"], "out", ["x.ts"])).toEqual({
      argv: [
        "bun",
        "--config=bunfig.related.toml",
        "test",
        "--timeout=15000",
        "--coverage-dir=out",
        "--reporter=junit",
        "--reporter-outfile=out/junit.xml",
        "./a.test.ts",
        "./b.test.ts",
      ],
      env: {},
    });
  });

  test("the istanbul job loads its preload first and writes the counters of the files it names", () => {
    expect(shardRun("istanbul", ["a.test.ts"], "out", ["x.ts", "y.tsx"])).toEqual({
      argv: ["bun", "--config=bunfig.shard.toml", "test", "--timeout=15000", "./a.test.ts"],
      env: {
        COVERAGE_FUNCS_FILES_PATH: "out/funcs-files.json",
        COVERAGE_FUNCS_OUT: "out/funcs.json",
      },
      targetsFile: { path: "out/funcs-files.json", text: '["x.ts","y.tsx"]' },
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

  test("the istanbul job's file list goes in a file, so the environment stays short however many sources there are (#2504)", () => {
    // Linux caps one environment string at 128 KB (MAX_ARG_STRLEN): the list was 63 bytes from half
    // of that, and any PR that added two source files turned the old size guard red.
    const tracked = Bun.spawnSync(["git", "ls-files"])
      .stdout.toString()
      .split("\n")
      .filter(Boolean);
    const targets = istanbulTargets(tracked);
    const run = shardRun("istanbul", [], "/tmp/out", targets);
    const envSize = Object.values(run.env).join("").length;
    expect(envSize).toBeLessThan(1024);
    expect(run.targetsFile?.path).toBe(run.env.COVERAGE_FUNCS_FILES_PATH ?? "");
    expect(JSON.parse(run.targetsFile?.text ?? "[]")).toEqual(targets);
    expect(targets.length).toBeGreaterThan(1000);
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

describe("shard-gate: istanbul sees every source (#296)", () => {
  test("the coverage:funcs preload loads no repo source before its plugin: it imports only the hooks module, which imports only istanbul", () => {
    // Validation run 42336750162: six scripts/lib files the preload imported were never instrumented,
    // and two of them could not be settled by Bun's counts.
    const preload = importsOf(readFileSync("scripts/test/coverage-funcs-preload.ts", "utf8"));
    expect(preload.filter((spec) => spec.startsWith("."))).toEqual([
      "../lib/coverage-gate/funcs-hooks.ts",
    ]);
    const hooks = importsOf(readFileSync("scripts/lib/coverage-gate/funcs-hooks.ts", "utf8"));
    expect(hooks).toEqual(["istanbul-lib-instrument"]);
  });
});

describe("shard-gate run: one shard job (#296, #828 review)", () => {
  const TRACKED = ["a.test.ts", "b.test.ts", "c.test.ts", "src/x.ts"];
  function fakes(result = { exit: 0, log: " 1 pass\n 0 fail\nRan 1 test across 1 file." }) {
    const written = new Map<string, string>();
    const spawned: Array<{ argv: string[]; env: Record<string, string> }> = [];
    const printed: string[] = [];
    return {
      written,
      spawned,
      printed,
      deps: {
        root: "/repo",
        tracked: TRACKED,
        timings: { "a.test.ts": 1, "b.test.ts": 1, "c.test.ts": 1 },
        mkdir: () => {},
        write: (path: string, text: string) => written.set(path, text),
        spawn: async (argv: string[], env: Record<string, string>) => {
          spawned.push({ argv, env });
          return result;
        },
        print: (line: string) => printed.push(line),
      },
    };
  }

  test("runs the shard's test files, keeps the log, and writes the marker the merge reads", async () => {
    const f = fakes();
    expect(await runShard("2/3", "bun", "/tmp/out", f.deps)).toBe(0);
    expect(f.spawned).toEqual([shardRun("bun", ["b.test.ts"], "/tmp/out", ["src/x.ts"])]);
    expect(f.written.get(join("/tmp/out", "test.log"))).toContain("1 pass");
    expect(JSON.parse(f.written.get(join("/tmp/out", "marker.json")) ?? "")).toEqual({
      shard: 2,
      of: 3,
      kind: "bun",
      files: ["b.test.ts"],
      exit: 0,
      fail: 0,
    });
    expect(f.printed.at(-1)).toBe("shard 2/3 bun: 1 test file(s), exit 0");
  });

  test("a failed test run keeps its exit code and failed count in the marker", async () => {
    const f = fakes({ exit: 1, log: " 0 pass\n 2 fail\n" });
    expect(await runShard("1/3", "istanbul", "/tmp/out", f.deps)).toBe(1);
    expect(JSON.parse(f.written.get(join("/tmp/out", "marker.json")) ?? "")).toMatchObject({
      exit: 1,
      fail: 2,
    });
  });

  test("a shard that is not one of n, an unknown kind, or an empty shard is refused before anything runs", async () => {
    for (const [spec, kind] of [
      ["0/3", "bun"],
      ["4/3", "bun"],
      ["1.5/3", "bun"],
      ["x", "bun"],
      ["1/3", "jest"],
    ] as const) {
      const f = fakes();
      expect(await runShard(spec, kind, "/tmp/out", f.deps)).toBe(2);
      expect(f.spawned).toEqual([]);
    }
    // Four shards of three test files: the fourth is empty, and an empty bun test runs everything.
    const empty = fakes();
    expect(await runShard("4/4", "bun", "/tmp/out", empty.deps)).toBe(2);
    expect(empty.printed).toEqual(["shard-gate: shard 4/4 has no test files"]);
    expect(empty.spawned).toEqual([]);
  });

  test("an output folder inside the checkout, or the checkout itself, is refused", async () => {
    for (const out of ["out", "/repo/out", "/repo", "."]) {
      const f = fakes();
      f.deps.root = process.cwd();
      const at = out.startsWith("/repo") ? out.replace("/repo", process.cwd()) : out;
      expect(await runShard("1/3", "bun", at, f.deps)).toBe(2);
      expect(f.printed[0]).toContain("write the shard's output outside the checkout");
      expect(f.spawned).toEqual([]);
    }
  });
});

describe("shard-gate merge: the six job folders into the gate (#296, #828 review)", () => {
  /** The healthy jobs as folders on disk: marker.json plus lcov.info or funcs.json. */
  function disk(jobs: ShardJob[], extra: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(extra));
    jobs.forEach((job, i) => {
      // The paths as mergeShards joins them: with \ on Windows (#534).
      const name = join("/art", `job-${i}`);
      if (job.marker) files.set(join(name, "marker.json"), JSON.stringify(job.marker));
      if (job.data !== null) {
        files.set(
          join(name, job.marker?.kind === "istanbul" ? "funcs.json" : "lcov.info"),
          job.data,
        );
      }
    });
    const written = new Map<string, string>();
    const printed: string[] = [];
    const errors: string[] = [];
    const folders = () => [...new Set([...files.keys()].map((p) => p.split(/[\\/]/)[2] as string))];
    return {
      written,
      printed,
      errors,
      deps: {
        folders: (dir: string) => (dir === "/art" ? folders() : []),
        read: (path: string) => files.get(path) ?? null,
        write: (path: string, text: string) => written.set(path, text),
        tracked: TESTS,
        sources: ["a.ts"],
        print: (line: string) => printed.push(line),
        error: (line: string) => errors.push(line),
      },
    };
  }

  test("six healthy jobs pass, and the merged lcov is written for SonarCloud", () => {
    const d = disk(healthy());
    expect(mergeShards("/art", 3, "/out/lcov.info", d.deps)).toBe(0);
    expect(d.written.get("/out/lcov.info")).toBe(gate(healthy()).lcov);
    expect(d.printed).toEqual(["cobertura de 80% ou mais em 1 arquivos-fonte, de 3 shards"]);
  });

  test("a coverage gap fails with check-coverage.ts's header, and the lcov is still written", () => {
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
    const d = disk(jobs);
    expect(mergeShards("/art", 3, "/out/lcov.info", d.deps)).toBe(1);
    expect(d.errors).toEqual([
      "cobertura abaixo de 80% em 1 arquivo(s):",
      "  - a.ts: funções 1/2, linhas 1/2",
    ]);
    expect(d.written.has("/out/lcov.info")).toBe(true);
  });

  test("no folder at all, or a truncated marker, gives no verdict and names why", () => {
    const none = disk([]);
    none.deps.folders = () => [];
    expect(mergeShards("/art", 3, "/out/lcov.info", none.deps)).toBe(1);
    expect(none.errors[0]).toBe("the sharded run has no coverage verdict (7 problem(s)):");
    expect(none.written.size).toBe(0);
    const torn = disk(healthy(), { [join("/art", "torn", "marker.json")]: '{"shard": 1, "of"' });
    expect(mergeShards("/art", 3, "/out/lcov.info", torn.deps)).toBe(1);
    expect(torn.errors).toEqual([
      "the sharded run has no coverage verdict (1 problem(s)):",
      "  - a shard job left a report with no marker",
    ]);
  });
});

describe("shard-gate for a PR: only the changed sources are judged (#1761)", () => {
  const POOR = record(
    "b.ts",
    [0, 2],
    [
      [1, 0],
      [2, 0],
    ],
  );
  /** healthy() with a second loaded file, b.ts, that no shard covers. */
  const withPoorFile = () =>
    healthy().map((job) =>
      job.marker?.kind === "bun" ? { ...job, data: `${job.data}\n${POOR}\n` } : job,
    );

  test("a loaded file that is not a changed source stays in the merged lcov and is not judged", () => {
    const merged = gate(withPoorFile(), { only: true });
    expect(merged.problems).toEqual([]);
    expect(merged.lcov).toContain("SF:b.ts");
    // The control: the whole-suite gate judges every loaded file.
    expect(gate(withPoorFile()).problems.join("\n")).toContain("b.ts");
  });

  test("a changed source below the gate fails, and one no test loads is named", () => {
    expect(gate(withPoorFile(), { only: true, sources: ["b.ts"] }).problems.join("\n")).toContain(
      "b.ts",
    );
    expect(gate(healthy(), { only: true, sources: ["c.ts"] }).problems.join("\n")).toContain(
      "c.ts",
    );
  });

  test("a missing shard or a failed shard still gives no pass", () => {
    const missing = healthy().filter(
      (job) => !(job.marker?.shard === 2 && job.marker.kind === "bun"),
    );
    const closed = gate(missing, { only: true });
    expect(closed.closed).toBe(true);
    expect(closed.problems.join("\n")).toContain("shard 2/3 bun: missing");
    const failed = healthy();
    failed[0] = bun(1, failed[0]?.data ?? "", { exit: 1, fail: 2 });
    expect(gate(failed, { only: true }).problems.join("\n")).toContain("its tests failed");
  });
});

describe("shard-gate run and merge over a PR's selection (#1761)", () => {
  const written = () => new Map<string, string>();
  function runDeps(sel: { tests: string[]; targets: string[] }) {
    const files = written();
    const spawned: Array<{ argv: string[]; env: Record<string, string> }> = [];
    return {
      files,
      spawned,
      deps: {
        root: "/repo",
        tracked: ["a.test.ts", "b.test.ts", "c.test.ts", "src/x.ts"],
        timings: {},
        mkdir: () => {},
        write: (path: string, text: string) => files.set(path, text),
        spawn: async (argv: string[], env: Record<string, string>) => {
          spawned.push({ argv, env });
          return { exit: 0, log: " 1 pass\n 0 fail\n" };
        },
        print: () => {},
        selection: sel,
      },
    };
  }
  const SEL = { tests: ["a.test.ts", "c.test.ts"], targets: ["src/y.ts"] };

  test("a shard runs its part of the selection, and istanbul instruments the changed sources only", async () => {
    const d = runDeps(SEL);
    expect(await runShard("2/3", "istanbul", "/tmp/out", d.deps)).toBe(0);
    expect(d.spawned).toEqual([shardRun("istanbul", ["c.test.ts"], "/tmp/out", ["src/y.ts"])]);
    expect(JSON.parse(d.files.get(join("/tmp/out", "marker.json")) ?? "")).toMatchObject({
      files: ["c.test.ts"],
      of: 3,
    });
  });

  test("a shard the selection leaves empty runs nothing, passes, and leaves reports the merge reads", async () => {
    for (const kind of ["bun", "istanbul"] as const) {
      const d = runDeps(SEL);
      expect(await runShard("3/3", kind, "/tmp/out", d.deps)).toBe(0);
      expect(d.spawned).toEqual([]);
      expect(JSON.parse(d.files.get(join("/tmp/out", "marker.json")) ?? "")).toMatchObject({
        kind,
        files: [],
        exit: 0,
        fail: 0,
      });
      expect(d.files.get(join("/tmp/out", kind === "bun" ? "lcov.info" : "funcs.json"))).toBe(
        kind === "bun" ? "" : "{}",
      );
    }
  });

  function disk(jobs: ShardJob[]) {
    const files = new Map<string, string>();
    jobs.forEach((job, i) => {
      const name = join("/art", `job-${i}`);
      if (job.marker) files.set(join(name, "marker.json"), JSON.stringify(job.marker));
      if (job.data !== null) {
        files.set(
          join(name, job.marker?.kind === "istanbul" ? "funcs.json" : "lcov.info"),
          job.data,
        );
      }
    });
    const errors: string[] = [];
    const out = new Map<string, string>();
    return {
      errors,
      out,
      deps: {
        folders: () => [...new Set([...files.keys()].map((p) => p.split(/[\\/]/)[2] as string))],
        read: (path: string) => files.get(path) ?? null,
        write: (path: string, text: string) => out.set(path, text),
        // The tree holds a fourth test that the PR does not select.
        tracked: [...TESTS, "t4.test.ts"],
        sources: ["a.ts", "other.ts"],
        print: () => {},
        error: (line: string) => errors.push(line),
        selection: { tests: TESTS, targets: ["a.ts"] },
      },
    };
  }

  test("the merge expects exactly the selection's tests, and judges its changed sources", () => {
    const ok = disk(healthy());
    expect(mergeShards("/art", 3, "/out/lcov.info", ok.deps)).toBe(0);
    expect(ok.out.has("/out/lcov.info")).toBe(true);
    // The control: without the selection the fourth test is one no shard ran.
    const whole = disk(healthy());
    const { selection: _unused, ...deps } = whole.deps;
    expect(mergeShards("/art", 3, "/out/lcov.info", deps)).toBe(1);
    expect(whole.errors.join("\n")).toContain("ran in no shard");
  });

  test("a selection test that no shard ran, a failed shard and a changed source under the gate each fail the merge", () => {
    const absent = disk(healthy());
    absent.deps.selection = { tests: [...TESTS, "t5.test.ts"], targets: ["a.ts"] };
    expect(mergeShards("/art", 3, "/out/lcov.info", absent.deps)).toBe(1);
    expect(absent.errors.join("\n")).toContain("t5.test.ts");
    const failed = healthy();
    failed[1] = bun(2, failed[1]?.data ?? "", { exit: 1, fail: 1 });
    const red = disk(failed);
    expect(mergeShards("/art", 3, "/out/lcov.info", red.deps)).toBe(1);
    const low = healthy();
    low[2] = bun(
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
    low[5] = ist(3, { "a.ts": functions([0, 0]) });
    const under = disk(low);
    expect(mergeShards("/art", 3, "/out/lcov.info", under.deps)).toBe(1);
    expect(under.errors.join("\n")).toContain("a.ts");
  });
});

describe("selectionOf: the PR plan as a shard selection (#1761)", () => {
  const plan = (over: object) => ({ code: 0, output: "out", command: ["bun"], ...over });

  test("a plan with test files gives them and the changed sources to cover", () => {
    expect(selectionOf(plan({ files: ["a.test.ts"], targets: ["src/a.ts"] }))).toEqual({
      tests: ["a.test.ts"],
      targets: ["src/a.ts"],
    });
  });

  test("the whole suite (a global file changed) is no selection", () => {
    expect(selectionOf(plan({ files: "all" }))).toBeNull();
  });

  test("a plan that cannot run gives its own message; a change with nothing to test gives an empty selection", () => {
    expect(
      selectionOf(plan({ code: 1, command: null, output: "1 changed source with no test" })),
    ).toEqual({
      problem: "1 changed source with no test",
    });
    expect(selectionOf(plan({ code: 2, command: null, output: "no base" }))).toEqual({
      problem: "no base",
    });
    expect(selectionOf(plan({ code: 0, command: null }))).toEqual({ tests: [], targets: [] });
  });
});
