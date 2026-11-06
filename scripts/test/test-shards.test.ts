import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mergeTimings,
  parseBunLog,
  parseJunit,
  parseShard,
  type ShardDeps,
  shards,
  splitShards,
  type Timings,
  testFiles,
} from "../lib/test-shards.ts";

const sumOf = (shard: string[], timings: Timings) =>
  shard.reduce((total, file) => total + (timings[file] ?? 0), 0);

describe("testFiles", () => {
  test("keeps what bun test runs and never the mods' files", () => {
    const tracked = [
      "scripts/test/b.test.ts",
      "apps/daemon/test/a.test.ts",
      "apps/desktop/test/c.spec.tsx",
      "scripts/d_test.js",
      "scripts/e_spec.mjs",
      "scripts/lib/not-a-test.ts",
      "scripts/e2e/journeys-en.e2e.ts",
      "mods/m/x.test.ts",
      "docs/test.md",
    ];
    expect(testFiles(tracked)).toEqual([
      "apps/daemon/test/a.test.ts",
      "apps/desktop/test/c.spec.tsx",
      "scripts/d_test.js",
      "scripts/e_spec.mjs",
      "scripts/test/b.test.ts",
    ]);
  });
});

describe("splitShards", () => {
  const timings: Timings = { a: 10, b: 6, c: 5, d: 4, e: 3, f: 2 };

  test("the slowest file goes first, each to the lightest shard so far", () => {
    const [one, two] = splitShards(["a", "b", "c", "d", "e", "f"], timings, 2);
    expect(one).toEqual(["a", "d", "f"]);
    expect(two).toEqual(["b", "c", "e"]);
    expect(sumOf(one ?? [], timings)).toBe(16);
    expect(sumOf(two ?? [], timings)).toBe(14);
  });

  test("every file is on exactly one shard, however many shards", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g"];
    for (const count of [1, 2, 3, 5]) {
      const split = splitShards(files, timings, count);
      expect(split).toHaveLength(count);
      expect(split.flat().sort()).toEqual(files);
    }
  });

  test("a file with no time weighs the median of the known ones", () => {
    const split = splitShards(["a", "b", "c", "u"], { a: 10, b: 2, c: 6 }, 2);
    expect(split).toEqual([
      ["a", "b"],
      ["c", "u"],
    ]);
  });

  test("with no time at all every file weighs the same, so the shards hold the same count", () => {
    const split = splitShards(["a", "b", "c", "d"], {}, 2);
    expect(split.map((shard) => shard.length)).toEqual([2, 2]);
  });

  test("a time that is not a number counts as unknown, so no file is ever left out of every shard", () => {
    const bad = {
      a: "x",
      b: Number.NaN,
      c: -1,
      d: Number.POSITIVE_INFINITY,
      e: 4,
    } as unknown as Timings;
    const files = ["a", "b", "c", "d", "e", "f"];
    for (const count of [2, 3]) {
      expect(splitShards(files, bad, count).flat().sort()).toEqual(files);
    }
  });

  test("more shards than files leaves the last ones empty, and the answer is the same each time", () => {
    const first = splitShards(["a"], timings, 3);
    expect(first).toEqual([["a"], [], []]);
    expect(splitShards(["a"], timings, 3)).toEqual(first);
  });
});

describe("parseShard", () => {
  test("reads index/count", () => {
    expect(parseShard("1/3")).toEqual({ index: 1, count: 3 });
    expect(parseShard("3/3")).toEqual({ index: 3, count: 3 });
  });

  test("anything else is null", () => {
    for (const text of ["", "0/3", "4/3", "1/0", "a/b", "1", "1/3/5", "1/3 ", "-1/3"]) {
      expect(parseShard(text)).toBeNull();
    }
  });
});

const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" time="9.5">
  <testsuite name="scripts/test/a.test.ts" file="scripts/test/a.test.ts" tests="2" assertions="4" failures="0" skipped="0" time="1.25" hostname="h">
    <testsuite name="a describe" file="scripts/test/a.test.ts" line="8" tests="2" assertions="4" failures="0" skipped="0" time="0.9" hostname="h">
      <testcase name="t" classname="a describe" time="0.9" file="scripts/test/a.test.ts" line="9" assertions="4" />
    </testsuite>
  </testsuite>
  <testsuite name="apps/daemon/test/b.test.ts" file="apps/daemon/test/b.test.ts" tests="1" assertions="1" failures="0" skipped="0" time="7.5" hostname="h">
  </testsuite>
</testsuites>
`;

describe("parseJunit", () => {
  test("takes the seconds of each file's own suite, not of its describe blocks", () => {
    expect(parseJunit(JUNIT)).toEqual({
      "scripts/test/a.test.ts": 1.25,
      "apps/daemon/test/b.test.ts": 7.5,
    });
  });

  test("a tag with a huge run of word characters is read in linear time, not quadratic", () => {
    const started = performance.now();
    expect(parseJunit(`<testsuite ${"a".repeat(100_000)}>`)).toEqual({});
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a file that is not a JUnit report has no times", () => {
    expect(parseJunit("")).toEqual({});
    expect(parseJunit("not xml at all")).toEqual({});
  });
});

/** A GitHub Actions log of `bun test` on Windows: timestamps, CRLF, backslash paths, skips and a failure. */
const LOG = [
  "2026-11-05T23:29:21.3869441Z bun test v1.4.4 (38afee6c8)",
  "2026-11-05T23:29:21.4012445Z --shard=1/3: running 2/869 test files",
  "2026-11-05T23:29:21.4015606Z ",
  "2026-11-05T23:29:21.4016734Z ##[group]apps\\daemon\\test\\acoes-cli.test.ts:",
  "2026-11-05T23:29:22.7972809Z (pass) acoes-cli > parses [0.79ms]",
  "2026-11-05T23:29:23.8601444Z (pass) acoes-cli > lists the actions [1062.76ms]",
  "2026-11-05T23:29:23.9000000Z (skip) acoes-cli > not on this OS",
  "2026-11-05T23:29:24.0013322Z (fail) acoes-cli > a failing one: with [brackets] [137.5ms]",
  "2026-11-05T23:29:24.0100000Z ##[endgroup]",
  "2026-11-05T23:29:24.0200000Z (pass) outside any file [5000.00ms]",
  "2026-11-05T23:29:24.3106001Z ##[group]scripts\\test\\only-skipped.test.ts:",
  "2026-11-05T23:29:24.3200000Z (skip) only-skipped > x",
  "2026-11-05T23:29:25.8644945Z ##[group]packages/protocol/test/b.spec.tsx:",
  "2026-11-05T23:29:25.8700000Z (pass) b > one [10.5ms]",
  "2026-11-05T23:29:25.8800000Z (pass) b > two [20.25ms]",
  "",
].join("\r\n");

describe("parseBunLog", () => {
  test("sums the (pass) and (fail) milliseconds under each file, with paths as git writes them", () => {
    expect(parseBunLog(LOG)).toEqual({
      "apps/daemon/test/acoes-cli.test.ts": 1.20105,
      "scripts/test/only-skipped.test.ts": 0,
      "packages/protocol/test/b.spec.tsx": 0.03075,
    });
  });

  test("a group that is not a test file (a CI step) takes no times", () => {
    const log =
      "##[group]Run the step:\n(pass) stray [9ms]\n##[group]a/b.test.ts:\n(pass) t [2ms]\n";
    expect(parseBunLog(log)).toEqual({ "a/b.test.ts": 0.002 });
  });

  test("a log with no test files has no times", () => {
    expect(parseBunLog("")).toEqual({});
    expect(parseBunLog("2026-11-05T23:29:21Z nothing here")).toEqual({});
  });
});

describe("mergeTimings", () => {
  test("the new times replace the old, a file that is gone drops out, a file never timed stays out", () => {
    const merged = mergeTimings({ a: 1, b: 2, c: 3 }, { b: 5.12345, d: 4 }, ["e", "d", "b", "a"]);
    expect(merged).toEqual({ a: 1, b: 5.123, d: 4 });
    expect(Object.keys(merged)).toEqual(["a", "b", "d"]);
  });
});

/** A fake repository: tracked files, a timing file, JUnit files and `bun test` that records its call. */
function fake(
  opts: {
    tracked?: string[];
    timings?: Timings;
    junit?: Record<string, string>;
    code?: number;
    git?: null;
    tiers?: Record<string, string>;
  } = {},
) {
  const logs: string[] = [];
  const runs: string[][] = [];
  let written: Timings | undefined;
  let tierReads = 0;
  const deps: ShardDeps = {
    git: () =>
      opts.git === null
        ? null
        : (opts.tracked ?? ["a.test.ts", "b.test.ts", "c.test.ts", "lib/x.ts"]).join("\n"),
    readTimings: () => opts.timings ?? { "a.test.ts": 9, "b.test.ts": 5, "c.test.ts": 4 },
    writeTimings: (timings) => {
      written = timings;
    },
    readFile: (path) => opts.junit?.[path] ?? "",
    bun: async (args) => {
      runs.push(args);
      return opts.code ?? 0;
    },
    log: (line) => logs.push(line),
    tiers: () => {
      tierReads++;
      return opts.tiers ?? {};
    },
  };
  return { deps, logs, runs, written: () => written, tierReads: () => tierReads };
}

describe("shards: plan and run", () => {
  test("--tier keeps only the tests of those tiers, and a test no tier claims, before the split (#309)", async () => {
    const tracked = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"];
    const tiers = { "a.test.ts": "integration", "b.test.ts": "unit", "c.test.ts": "component" };
    const timings = { "a.test.ts": 9, "b.test.ts": 5, "c.test.ts": 4, "d.test.ts": 3 };
    const one = fake({ tracked, tiers, timings });
    expect(await shards(["plan", "1/2", "--tier", "unit,component"], one.deps)).toBe(0);
    const two = fake({ tracked, tiers, timings });
    expect(await shards(["plan", "2/2", "--tier", "unit,component"], two.deps)).toBe(0);
    // The integration test is gone, and the three left are balanced between the two shards.
    expect(one.logs).toEqual(["b.test.ts"]);
    expect(two.logs).toEqual(["c.test.ts", "d.test.ts"]);
  });

  test("run with --tier says which tiers it holds and runs only their files (#309)", async () => {
    const f = fake({
      tiers: { "a.test.ts": "integration", "b.test.ts": "unit", "c.test.ts": "unit" },
    });
    expect(await shards(["run", "1/1", "--tier", "unit", "--junit", "r.xml"], f.deps)).toBe(0);
    expect(f.logs[0]).toContain("shard 1/1 (unit): 2 files");
    expect(f.runs[0]?.slice(-3)).toEqual([
      "--reporter-outfile=r.xml",
      "./b.test.ts",
      "./c.test.ts",
    ]);
  });

  test("--files keeps only the test files the list names before the split, and a '*' line keeps them all (#399)", async () => {
    const timings = { "a.test.ts": 9, "b.test.ts": 5, "c.test.ts": 4 };
    const some = fake({ timings, junit: { "sel.txt": "b.test.ts\nc.test.ts\nlib/x.ts\n\n" } });
    expect(await shards(["plan", "1/1", "--files", "sel.txt"], some.deps)).toBe(0);
    expect(some.logs).toEqual(["b.test.ts", "c.test.ts"]);
    const all = fake({ timings, junit: { "sel.txt": "*\n" } });
    expect(await shards(["plan", "1/1", "--files", "sel.txt"], all.deps)).toBe(0);
    expect(all.logs).toEqual(["a.test.ts", "b.test.ts", "c.test.ts"]);
    const run = fake({ timings, junit: { "sel.txt": "c.test.ts\n" } });
    expect(await shards(["run", "1/1", "--files", "sel.txt", "--junit", "r.xml"], run.deps)).toBe(
      0,
    );
    expect(run.logs[0]).toContain("shard 1/1 (selection): 1 files");
    expect(run.runs[0]?.at(-1)).toBe("./c.test.ts");
  });

  test("--files fails on a listed name that is no tracked test, and an empty shard runs nothing instead of the whole suite (#410 review)", async () => {
    const typo = fake({ junit: { "sel.txt": "b.test.ts\nnope.test.ts\n" } });
    expect(await shards(["run", "1/1", "--files", "sel.txt"], typo.deps)).toBe(1);
    expect(typo.runs).toEqual([]);
    expect(typo.logs.join("\n")).toContain("nope.test.ts");
    const empty = fake({ junit: { "sel.txt": "c.test.ts\n" } });
    expect(await shards(["run", "2/2", "--files", "sel.txt"], empty.deps)).toBe(0);
    expect(empty.runs).toEqual([]);
    expect(empty.logs.join("\n")).toContain("no test files");
  });

  test("--files with no list is the usage, exit 2, and nothing runs (#399)", async () => {
    const f = fake();
    expect(await shards(["run", "1/2", "--files"], f.deps)).toBe(2);
    expect(f.runs).toEqual([]);
  });

  test("without --tier the tiers are never read (#309)", async () => {
    const f = fake();
    expect(await shards(["run", "1/2"], f.deps)).toBe(0);
    expect(f.tierReads()).toBe(0);
  });

  test("--tier with no list or an unknown tier is the usage, exit 2, and nothing runs (#309)", async () => {
    for (const argv of [
      ["run", "1/2", "--tier"],
      ["run", "1/2", "--tier", "unit,smoke"],
    ]) {
      const f = fake();
      expect(await shards(argv, f.deps)).toBe(2);
      expect(f.runs).toEqual([]);
    }
  });

  test("plan prints the files of one shard, one per line", async () => {
    const f = fake();
    expect(await shards(["plan", "1/2"], f.deps)).toBe(0);
    expect(f.logs).toEqual(["a.test.ts"]);
    const g = fake();
    expect(await shards(["plan", "2/2"], g.deps)).toBe(0);
    expect(g.logs).toEqual(["b.test.ts", "c.test.ts"]);
  });

  test("run says what the shard holds, then runs bun test on exactly its files", async () => {
    const f = fake();
    expect(await shards(["run", "2/2"], f.deps)).toBe(0);
    expect(f.logs[0]).toContain("shard 2/2: 2 files, about 9 s");
    expect(f.runs).toEqual([
      [
        "--config=bunfig.area.toml",
        "test",
        "--timeout=15000",
        "--reporter=junit",
        "--reporter-outfile=junit-2.xml",
        "./b.test.ts",
        "./c.test.ts",
      ],
    ]);
  });

  test("--junit names the report, and the exit code of bun test is the run's", async () => {
    const f = fake({ code: 1 });
    expect(await shards(["run", "1/2", "--junit", "out/r.xml"], f.deps)).toBe(1);
    expect(f.runs[0]).toContain("--reporter-outfile=out/r.xml");
  });

  test("a bad shard or command is the usage, exit 2, and nothing runs", async () => {
    const f = fake();
    for (const argv of [
      [],
      ["plan"],
      ["plan", "4/3"],
      ["run", "x"],
      ["nothing", "1/3"],
      ["record"],
    ]) {
      expect(await shards(argv, f.deps)).toBe(2);
    }
    expect(f.runs).toEqual([]);
    expect(f.logs.some((line) => line.startsWith("usage:"))).toBe(true);
  });

  test("git failing is an error, not an empty shard that passes", async () => {
    const f = fake({ git: null });
    expect(await shards(["run", "1/2"], f.deps)).toBe(1);
    expect(f.runs).toEqual([]);
  });
});

describe("shards: record", () => {
  test("merges the JUnit files into the timing file, for the test files that exist", async () => {
    const f = fake({ junit: { "one.xml": JUNIT, "two.xml": JUNIT.replace(/1\.25/, "2.5") } });
    expect(await shards(["record", "one.xml", "two.xml"], f.deps)).toBe(0);
    // none of the JUnit's files is tracked in this fake repository, so the old times stay
    expect(f.written()).toEqual({ "a.test.ts": 9, "b.test.ts": 5, "c.test.ts": 4 });
    expect(f.logs.join("\n")).toContain("0 file(s) timed");
  });

  test("a CI log is read too: record takes JUnit files and bun test logs alike", async () => {
    const f = fake({
      tracked: ["apps/daemon/test/acoes-cli.test.ts", "packages/protocol/test/b.spec.tsx"],
      timings: {},
      junit: { "shard.log": LOG },
    });
    expect(await shards(["record", "shard.log"], f.deps)).toBe(0);
    expect(f.written()).toEqual({
      "apps/daemon/test/acoes-cli.test.ts": 1.201,
      "packages/protocol/test/b.spec.tsx": 0.031,
    });
  });

  test("a JUnit file of tracked tests moves their times", async () => {
    const f = fake({
      tracked: ["scripts/test/a.test.ts", "apps/daemon/test/b.test.ts"],
      timings: { "scripts/test/a.test.ts": 99 },
      junit: { "one.xml": JUNIT },
    });
    expect(await shards(["record", "one.xml"], f.deps)).toBe(0);
    expect(f.written()).toEqual({
      "scripts/test/a.test.ts": 1.25,
      "apps/daemon/test/b.test.ts": 7.5,
    });
    expect(f.logs.join("\n")).toContain("2 file(s) timed");
  });
});

describe("scripts/test-timings.json", () => {
  const path = join(import.meta.dir, "..", "test-timings.json");

  test("is a map from a test file to the seconds it took, as `record` writes it", () => {
    expect(existsSync(path)).toBe(true);
    const timings = JSON.parse(readFileSync(path, "utf8")) as Timings;
    const files = Object.keys(timings);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(testFiles(files));
    for (const seconds of Object.values(timings)) {
      expect(Number.isFinite(seconds) && seconds >= 0).toBe(true);
    }
    expect(JSON.stringify(timings, null, 2) + "\n").toBe(readFileSync(path, "utf8"));
  });
});
