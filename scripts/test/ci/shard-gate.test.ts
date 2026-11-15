import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  failedCount,
  type GateInput,
  istanbulTargets,
  type ShardJob,
  shardRun,
} from "../../lib/tests/shard-gate.ts";
import { importsOf } from "../../lib/tests/test-related.ts";
import { bun, functions, gate, healthy, ist, marker, record, TESTS } from "./shard-gate-setup.ts";

// repo-wide (#1108): reads the tracked file list, so CI's quick job runs it on every PR.

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
