import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { FlightdeckError } from "../src/errors.ts";
import {
  MODELS_CACHE_MS,
  OpenCodeModels,
  runCommand,
  TIMED_OUT,
} from "../src/runtime/opencode-process.ts";

const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof FlightdeckError ? error.reason : String(error)),
  );

describe("opencode-models", () => {
  test("runCommand gives the output and the exit code, in the folder and environment given", async () => {
    const cwd = realTempDir("fd-oc-run-");
    const ok = await runCommand(
      [process.execPath, "-e", "console.log(process.env.FD_X); console.log(process.cwd())"],
      {
        cwd,
        env: { PATH: process.env.PATH ?? "", FD_X: "x1" },
        timeoutMs: 5_000,
      },
    );
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.split("\n").slice(0, 2)).toEqual(["x1", cwd]);
    const failed = await runCommand([process.execPath, "-e", "process.exit(3)"], {
      cwd,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5_000,
    });
    expect(failed.exitCode).toBe(3);
  });

  test.skipIf(process.platform === "win32")(
    "a command past its deadline ends, with what it started, and reports TIMED_OUT",
    async () => {
      const cwd = realTempDir("fd-oc-run-");
      const marker = join(cwd, "late");
      const started = Date.now();
      const result = await runCommand(["sh", "-c", `(sleep 2 && touch ${marker}) & sleep 30`], {
        cwd,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 300,
      });
      expect(result.exitCode).toBe(TIMED_OUT);
      expect(Date.now() - started).toBeLessThan(5_000);
      // timing: the started job would touch the marker 2 s in; it must have been killed with the group.
      await Bun.sleep(2_500);
      expect(existsSync(marker)).toBe(false);
    },
  );

  test("the models come from `models --standalone` in an empty folder of Flightdeck's, with the OpenCode env", async () => {
    const dataDir = realTempDir("fd-oc-data-");
    const calls: Array<{
      argv: string[];
      cwd: string;
      env: Record<string, string>;
      timeoutMs: number;
    }> = [];
    const models = new OpenCodeModels({
      path: "/bin/opencode",
      env: { HOME: "/h", OPENCODE_CONFIG: "/evil" },
      dataDir,
      scan: async () => ({ findings: [], fingerprint: "f" }),
      run: async (argv, opts) => {
        calls.push({ argv, cwd: opts.cwd, env: opts.env, timeoutMs: opts.timeoutMs });
        return {
          exitCode: 0,
          stdout: "anthropic/claude-sonnet-5-5\nopencode/crouton-alpha-free\n\n",
        };
      },
    });
    expect(await models.list()).toEqual([
      { id: "anthropic/claude-sonnet-5-5", name: "anthropic/claude-sonnet-5-5" },
      { id: "opencode/crouton-alpha-free", name: "opencode/crouton-alpha-free" },
    ]);
    expect(
      calls.map((c) => [
        c.argv,
        c.cwd,
        c.env.OPENCODE_DISABLE_PROJECT_CONFIG,
        c.env.OPENCODE_CONFIG,
        c.timeoutMs,
      ]),
    ).toEqual([
      [
        ["/bin/opencode", "models", "--standalone"],
        join(dataDir, "opencode-models"),
        "1",
        undefined,
        30_000,
      ],
    ]);
  });

  test("the list is cached 5 minutes; an unsafe scope or a failed run answers runtime_unavailable", async () => {
    let now = 0;
    let runs = 0;
    let fail = false;
    let findings: Array<{ kind: "plugins_entry"; path: string; detail: string }> = [];
    const models = new OpenCodeModels({
      path: "/bin/opencode",
      env: {},
      dataDir: realTempDir("fd-oc-data-"),
      now: () => now,
      scan: async () => ({ findings, fingerprint: "f" }),
      run: async () => {
        runs++;
        return fail ? { exitCode: 1, stdout: "" } : { exitCode: 0, stdout: "a/b\n" };
      },
    });
    await models.list();
    await models.list();
    expect(runs).toBe(1);
    now += MODELS_CACHE_MS + 1;
    fail = true;
    expect(await reasonOf(models.list())).toBe("runtime_unavailable");
    fail = false;
    findings = [{ kind: "plugins_entry", path: "/g/opencode.json", detail: "x" }];
    expect(await reasonOf(models.list())).toBe("runtime_unavailable");
    expect(runs).toBe(2);
  });
});
