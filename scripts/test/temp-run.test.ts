import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

  test.skipIf(process.platform === "win32")(
    "removing it never changes what a link inside points at: the link goes, the file outside keeps its mode (#232)",
    () => {
      // The PATH guard links every program of ~/.local/bin into the run's folder; a chmod that
      // followed those links left the user's programs at 0666, not executable.
      const outside = realTempDir("fd-temp-run-outside-");
      const program = join(outside, "tool");
      writeFileSync(program, "#!/bin/sh\n");
      chmodSync(program, 0o755);
      const base = realTempDir("fd-temp-run-base-");
      const run = installTempRun({}, base);
      mkdirSync(join(run.dir, "fd-path-guard-x"));
      symlinkSync(program, join(run.dir, "fd-path-guard-x", "tool"));
      symlinkSync(outside, join(run.dir, "linked-folder"));
      const folderMode = statSync(outside).mode & 0o777;
      expect(removeTempRun(run)).toBe(true);
      expect(readdirSync(base)).toEqual([]);
      // The folder first: a folder that lost its x bit hides what it holds.
      expect(statSync(outside).mode & 0o777).toBe(folderMode);
      expect(statSync(program).mode & 0o777).toBe(0o755);
      expect(readdirSync(outside)).toEqual(["tool"]);
    },
  );

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

  test("the sweep never throws: a pid file it cannot read is skipped and the run goes on", () => {
    const base = realTempDir("fd-temp-run-base-");
    // A directory where the pid file should be: reading it fails (on Windows, a file held by a
    // process that has just swept the same folder does the same).
    mkdirSync(join(base, "fd-run-odd", "pid"), { recursive: true });
    const run = installTempRun({}, base, () => false);
    expect(run.dir.startsWith(join(base, "fd-run-"))).toBe(true);
    expect(readdirSync(base)).toContain("fd-run-odd");
  });

  test("one process start sweeps at most one dead folder, so a crowd of starting processes does not pile up its budget", () => {
    const base = realTempDir("fd-temp-run-base-");
    for (const name of ["fd-run-dead-a", "fd-run-dead-b", "fd-run-dead-c"]) {
      mkdirSync(join(base, name));
      writeFileSync(join(base, name, "pid"), "999999");
    }
    const run = installTempRun({}, base, () => false);
    const left = readdirSync(base).filter((name) => name.startsWith("fd-run-dead-"));
    expect(left).toHaveLength(2);
    expect(run.dir.startsWith(join(base, "fd-run-"))).toBe(true);
  });
});
