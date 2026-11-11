import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/watch/check-run.ts";
import { REMOVED_LINE } from "../../src/watch/trace.ts";
import type { BoundedCheckResult } from "../../src/workflows/check-runner.ts";
import { checkEnvironment } from "../../src/workflows/check-runner.ts";

/**
 * Issue #1361 (slice 1c-2a): the project's checks, run in order up to the first that does not
 * pass, shared by the watch and the check loop. What a check printed is masked whole, before
 * anyone cuts it (docs/decisions/2026-11-09-check-loop.md).
 */
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function runner(answers: Record<string, BoundedCheckResult>) {
  const calls: Array<{
    command: string;
    cwd: string;
    timeoutMs: number | undefined;
    names: readonly string[] | undefined;
  }> = [];
  return {
    calls,
    run: async (
      command: string,
      cwd: string,
      timeoutMs?: number,
      _signal?: AbortSignal,
      names?: readonly string[],
    ) => {
      calls.push({ command, cwd, timeoutMs, names });
      return answers[command] ?? { exitCode: 0, output: "" };
    },
  };
}

describe("check-loop: the checks, run once for the watch and the loop", () => {
  test("they run in order and stop at the first that fails, with its whole output masked", async () => {
    const fake = runner({ lint: { exitCode: 2, output: `ok\n${TOKEN}\nbad` } });
    const outcome = await runChecks({
      checks: ["test", "lint", "build"],
      worktree: "/w/tree",
      timeoutMin: 1,
      envNames: ["JAVA_HOME"],
      runner: fake,
    });
    expect([outcome, fake.calls]).toEqual([
      {
        kind: "failed",
        command: "lint",
        exitCode: 2,
        timedOut: false,
        tooLarge: false,
        output: `ok\n${REMOVED_LINE}\nbad`,
      },
      [
        // In the card's worktree, for the project's timeout in milliseconds.
        { command: "test", cwd: "/w/tree", timeoutMs: 60_000, names: ["JAVA_HOME"] },
        { command: "lint", cwd: "/w/tree", timeoutMs: 60_000, names: ["JAVA_HOME"] },
      ],
    ]);
  });

  test("a command that carries a secret is reported masked, failed or aborted", async () => {
    const command = `bun test --token ${TOKEN}`;
    const failed = await runChecks({
      checks: [command],
      worktree: "/w/tree",
      timeoutMin: 1,
      envNames: [],
      runner: runner({ [command]: { exitCode: 1, output: "" } }),
    });
    const stop = new AbortController();
    const aborted = await runChecks({
      checks: [command],
      worktree: "/w/tree",
      timeoutMin: 1,
      envNames: [],
      runner: {
        run: async () => ({ exitCode: 0, output: "", aborted: true }),
      },
      signal: stop.signal,
    });
    expect([
      failed.kind === "failed" && failed.command.includes(TOKEN),
      aborted.kind === "aborted" && aborted.command.includes(TOKEN),
      failed.kind,
      aborted.kind,
    ]).toEqual([false, false, "failed", "aborted"]);
  });

  test("a refused command never runs, a stop says so, and all passing says passed", async () => {
    const refused = runner({});
    const stop = new AbortController();
    stop.abort();
    const aborted = runner({ test: { exitCode: 137, output: "", aborted: true } });
    const passing = runner({});
    expect([
      await runChecks({
        checks: ["rm -rf /"],
        worktree: "/w/tree",
        timeoutMin: 1,
        envNames: [],
        runner: refused,
      }),
      refused.calls.length,
      await runChecks({
        checks: ["test"],
        worktree: "/w/tree",
        timeoutMin: 1,
        envNames: [],
        runner: aborted,
        signal: stop.signal,
      }),
      await runChecks({
        checks: ["a", "b"],
        worktree: "/w/tree",
        timeoutMin: 1,
        envNames: [],
        runner: passing,
      }),
    ]).toEqual([
      { kind: "refused", command: "rm -rf /", refusal: "outside_worktree" },
      0,
      { kind: "aborted", command: "test" },
      { kind: "passed" },
    ]);
  });
});

describe("check-loop: a project's extra names at use", () => {
  test("only the names the rule allows are added, with the daemon's values, in any case on Windows", () => {
    const source = { PATH: "/bin", JAVA_HOME: "/jdk", LD_PRELOAD: "/x.so", GITHUB_TOKEN: "t" };
    const windows = { Path: "C:\\bin", Java_Home: "C:\\jdk" };
    expect([
      checkEnvironment(source, "linux", [
        "JAVA_HOME",
        "LD_PRELOAD",
        "GITHUB_TOKEN",
        "MISSING_HOME",
      ]),
      checkEnvironment(windows, "win32", ["JAVA_HOME"]),
    ]).toEqual([
      { PATH: "/bin", JAVA_HOME: "/jdk", CI: "1" },
      { Path: "C:\\bin", Java_Home: "C:\\jdk", CI: "1" },
    ]);
  });
});
