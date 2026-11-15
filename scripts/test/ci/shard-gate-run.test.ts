import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mergeShards, runShard, type ShardJob, shardRun } from "../../lib/tests/shard-gate.ts";
import { bun, functions, gate, healthy, ist, record, TESTS } from "./shard-gate-setup.ts";

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
