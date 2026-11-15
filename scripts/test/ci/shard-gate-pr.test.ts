import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  mergeShards,
  runShard,
  type ShardJob,
  selectionOf,
  shardRun,
} from "../../lib/tests/shard-gate.ts";
import { bun, functions, gate, healthy, ist, record, TESTS } from "./shard-gate-setup.ts";

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
    const { argv, env } = shardRun("istanbul", ["c.test.ts"], "/tmp/out", ["src/y.ts"]);
    expect(d.spawned).toEqual([{ argv, env }]);
    // The instrumented list is in the file the env names (#2504).
    expect(d.files.get(env.COVERAGE_FUNCS_FILES_PATH ?? "")).toBe('["src/y.ts"]');
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
      // The shard's own slow-test step (#3295) reads a report: an empty one, not a missing one.
      expect(d.files.get(join("/tmp/out", "junit.xml"))).toBe(
        kind === "bun" ? "<testsuites></testsuites>" : undefined,
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
