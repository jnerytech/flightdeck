import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "./temp-dir.ts";
import { installTempRun, removeTempRun } from "./temp-run.ts";

const ROOT = join(import.meta.dir, "../..");

describe("temp-run: each test run has a temp folder of its own, removed at the end", () => {
  test("the run's folder is new, inside the temp folder it found, and TEMP, TMP and TMPDIR point at it", () => {
    const base = realTempDir("fd-temp-run-base-");
    const env: Record<string, string | undefined> = { TEMP: base, TMP: base, TMPDIR: base };
    const run = installTempRun(env, base);
    expect(run.dir.startsWith(join(base, "fd-run-"))).toBe(true);
    expect([env.TEMP, env.TMP, env.TMPDIR]).toEqual([run.dir, run.dir, run.dir]);
    expect(readdirSync(base)).toEqual([run.dir.slice(base.length + 1)]);
  });

  test("removing it leaves the temp folder as the run found it", () => {
    const base = realTempDir("fd-temp-run-base-");
    const run = installTempRun({}, base);
    mkdirSync(join(run.dir, "fd-test-x", "deep"), { recursive: true });
    writeFileSync(join(run.dir, "fd-test-x", "deep", "f.txt"), "x");
    expect(removeTempRun(run)).toBe(true);
    expect(readdirSync(base)).toEqual([]);
  });

  test("a run sweeps the folders of earlier runs whose process is gone, and only those", () => {
    const base = realTempDir("fd-temp-run-base-");
    for (const [name, pid] of [
      ["fd-run-dead", "999999"],
      ["fd-run-live", String(process.pid)],
      ["fd-run-starting", null],
      ["fd-test-older", null],
    ] as const) {
      mkdirSync(join(base, name));
      if (pid) writeFileSync(join(base, name, "pid"), pid);
    }
    const run = installTempRun({}, base, (pid) => pid === process.pid);
    expect(readdirSync(base).sort()).toEqual(
      ["fd-run-live", "fd-run-starting", "fd-test-older", run.dir.slice(base.length + 1)].sort(),
    );
  });

  test("a test run leaves nothing in the temp folder, whether its tests pass or fail", () => {
    for (const fail of [false, true]) {
      const base = realTempDir("fd-temp-run-base-");
      const proc = Bun.spawnSync(
        [
          process.execPath,
          "--config=bunfig.area.toml",
          "test",
          "./scripts/test/temp-run-fixture.ts",
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            TEMP: base,
            TMP: base,
            TMPDIR: base,
            ...(fail ? { FD_TEMP_RUN_FAIL: "1" } : {}),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = proc.stdout.toString() + proc.stderr.toString();
      expect(output).toContain(`temp-run-fixture tmpdir=${join(base, "fd-run-")}`);
      expect(proc.exitCode).toBe(fail ? 1 : 0);
      expect(readdirSync(base)).toEqual([]);
    }
  }, 60_000);

  test("removing a big folder stops at the time budget, leaves the rest to the next run's sweep and never throws", () => {
    const base = realTempDir("fd-temp-run-base-");
    const run = installTempRun({}, base);
    for (let i = 0; i < 20; i++) {
      mkdirSync(join(run.dir, `fd-test-${i}`));
      writeFileSync(join(run.dir, `fd-test-${i}`, "f.txt"), "x");
    }
    let clock = 0;
    // Every look at the clock costs a millisecond: a budget of 5 ms cannot reach the end.
    expect(removeTempRun(run, 5, () => clock++)).toBe(false);
    expect(readdirSync(run.dir).length).toBeGreaterThan(1);
    // The pid file stays until the end, so the sweep still knows the folder is dead and takes it.
    installTempRun({}, base, () => false);
    expect(readdirSync(base).filter((name) => run.dir.endsWith(name))).toEqual([]);
  });
});
