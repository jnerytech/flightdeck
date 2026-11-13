import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type IstanbulChangedDeps, istanbulChanged } from "../../lib/tests/istanbul-changed.ts";
import { shardRun, spawnLogged } from "../../lib/tests/shard-gate.ts";
import { realTempDir } from "../temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const OUT = "/tmp/istanbul-out";
const TRACKED = [
  "scripts/lib/shots/holds.ts",
  "scripts/test/demo/shots-holds.test.ts",
  "scripts/test/other.test.ts",
  "apps/desktop/src/features/hosts/page.tsx",
  "apps/desktop/test/host-ui.test.tsx",
  "apps/desktop/test/dom.ts",
];

/** The deps over fakes: what was spawned and printed is kept. */
function fakes(changed: string[] | null, run = { exit: 0, log: " 3 pass\n 0 fail\nRan 3 tests" }) {
  const spawned: Array<{ argv: string[]; env: Record<string, string> }> = [];
  const printed: string[] = [];
  const made: string[] = [];
  const written = new Map<string, string>();
  const deps: IstanbulChangedDeps = {
    root: "/repo",
    tracked: TRACKED,
    changed: async () => changed,
    mkdir: (path) => void made.push(path),
    write: (path, text) => void written.set(path, text),
    spawn: async (argv, env) => {
      spawned.push({ argv, env });
      return run;
    },
    print: (line) => void printed.push(line),
  };
  return { deps, spawned, printed, made, written };
}

/**
 * Issue #1493: a PR runs its changed test files under istanbul, as the full run's istanbul shards
 * do, so an istanbul-only red (#1492) shows in the PR.
 */
describe("istanbul-changed (#1493)", () => {
  test("only the changed test files run, under the istanbul shard's command, over every source", async () => {
    const f = fakes([
      "scripts/lib/shots/holds.ts",
      "scripts/test/demo/shots-holds.test.ts",
      "apps/desktop/test/host-ui.test.tsx",
      "apps/desktop/test/dom.ts",
      "scripts/test/gone.test.ts",
    ]);
    const code = await istanbulChanged("abc123", OUT, f.deps);
    const sources = ["scripts/lib/shots/holds.ts", "apps/desktop/src/features/hosts/page.tsx"];
    const expected = shardRun(
      "istanbul",
      ["apps/desktop/test/host-ui.test.tsx", "scripts/test/demo/shots-holds.test.ts"],
      OUT,
      sources,
    );
    expect([code, f.spawned, f.made]).toEqual([
      0,
      [{ argv: expected.argv, env: expected.env }],
      [OUT],
    ]);
    // The sources go in a file the env names, not in the env itself (#2504).
    expect(f.written).toEqual(new Map([[`${OUT}/funcs-files.json`, JSON.stringify(sources)]]));
    expect(expected.env.COVERAGE_FUNCS_FILES_PATH).toBe(`${OUT}/funcs-files.json`);
  });

  test("with no changed test file nothing runs: a bare bun test would run the whole suite", async () => {
    const f = fakes(["scripts/lib/shots/holds.ts"]);
    const code = await istanbulChanged("abc123", OUT, f.deps);
    expect([code, f.spawned.length, f.printed]).toEqual([
      0,
      0,
      ["istanbul-changed: no changed test files since abc123"],
    ]);
  });

  test("a failed test fails the step and its log is printed; a fail count alone fails it too", async () => {
    const red = fakes(["scripts/test/demo/shots-holds.test.ts"], {
      exit: 1,
      log: "ReferenceError: cov_1otmt125mr is not defined\n 0 pass\n 1 fail",
    });
    const counted = fakes(["scripts/test/demo/shots-holds.test.ts"], { exit: 0, log: " 2 fail" });
    // A crash or a kill (137) says nothing in the log: the exit code alone fails the step.
    const killed = fakes(["scripts/test/demo/shots-holds.test.ts"], {
      exit: 137,
      log: " 4 pass\n 0 fail",
    });
    const codes = [
      await istanbulChanged("abc123", OUT, red.deps),
      await istanbulChanged("abc123", OUT, counted.deps),
      await istanbulChanged("abc123", OUT, killed.deps),
    ];
    expect([codes, red.printed.includes("ReferenceError: cov_1otmt125mr is not defined")]).toEqual([
      [1, 1, 1],
      true,
    ]);
  });

  test("it fails closed: no base, a base git would read as an option, an output inside the checkout, or no diff", async () => {
    const noBase = fakes(["scripts/test/demo/shots-holds.test.ts"]);
    const option = fakes(["scripts/test/demo/shots-holds.test.ts"]);
    const inside = fakes(["scripts/test/demo/shots-holds.test.ts"]);
    const noDiff = fakes(null);
    const codes = [
      await istanbulChanged("", OUT, noBase.deps),
      await istanbulChanged("--output=x", OUT, option.deps),
      await istanbulChanged("abc123", "/repo/coverage/istanbul", inside.deps),
      await istanbulChanged("abc123", OUT, noDiff.deps),
    ];
    const spawned = [noBase, option, inside, noDiff].map((f) => f.spawned.length);
    expect([codes, spawned, noDiff.printed]).toEqual([
      [2, 2, 2, 1],
      [0, 0, 0, 0],
      ["istanbul-changed: git could not list the files changed since abc123"],
    ]);
  });

  test("the istanbul command fails a test that runs an instrumented function's source alone", async () => {
    // A real run of the fixture under the istanbul shard's command, with its source instrumented.
    const out = realTempDir("istanbul-changed-");
    const dir = "scripts/test/fixtures/istanbul-serialize";
    const plan = shardRun("istanbul", [`${dir}/serialized.fixture.ts`], out, [
      `${dir}/serialized.ts`,
    ]);
    if (plan.targetsFile) writeFileSync(plan.targetsFile.path, plan.targetsFile.text);
    const proc = Bun.spawn(plan.argv, {
      cwd: ROOT,
      env: { ...process.env, ...plan.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const log = (await new Response(proc.stderr).text()) + (await new Response(proc.stdout).text());
    expect([await proc.exited, /cov_\w+ is not defined/.test(log)]).toEqual([1, true]);
  }, 15_000);

  test("the scripts' spawn gives the exit code and the output, stdout then stderr, with the env added", async () => {
    const spawn = spawnLogged(ROOT);
    const ran = await spawn(["bash", "-c", 'echo "out $EXTRA"; echo err >&2; exit 3'], {
      EXTRA: "added",
    });
    expect(ran).toEqual({ exit: 3, log: "out added\nerr\n" });
  });
});
