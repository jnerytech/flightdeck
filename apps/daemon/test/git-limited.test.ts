import { describe, expect, test } from "bun:test";
import { gitLimitedFor } from "../src/board/command.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #100: the capped git read the teleport's secret scan goes through also has a time limit.
 * A git that hangs (an index lock, a slow repository) is killed with what it started, and the
 * result says so, instead of holding the package forever.
 */
describe("git-limited: a capped git read with a time limit (#100)", () => {
  test("a git still running at the limit is killed and the result says it timed out", async () => {
    const started = Date.now();
    // An alias that runs a shell command: a git that does not end by itself, with no network.
    const result = await gitLimitedFor(
      tempDir("fd-git-limited-"),
      1024,
      ["-c", "alias.hang=!sleep 3", "hang"],
      200,
    );
    expect([result.timedOut, result.code === 0, Date.now() - started < 2_500]).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("a kill that fails at the limit still gives an answer that says it timed out", async () => {
    const result = await gitLimitedFor(
      tempDir("fd-git-limited-"),
      1024,
      ["-c", "alias.wait=!sleep 1", "wait"],
      100,
      async () => {
        throw new Error("the process was already gone");
      },
    );
    expect(result.timedOut).toBe(true);
  });

  test("a program that writes far more to stderr than a pipe holds still ends, with its stdout and a capped stderr (#806)", async () => {
    // 200 000 bytes on stderr first: read after stdout, the pipe would fill and the program stall.
    const result = await gitLimitedFor(
      tempDir("fd-git-limited-"),
      1024,
      ["-c", "alias.noisy=!head -c 200000 /dev/zero >&2; echo done", "noisy"],
      3_000,
    );
    expect([
      result.stdout,
      result.timedOut,
      result.stderr.length > 0,
      result.stderr.length <= 64 * 1024,
    ]).toEqual(["done\n", undefined, true, true]);
  });

  test("a git that ends in time gives its output and no time-out", async () => {
    const result = await gitLimitedFor(tempDir("fd-git-limited-"), 1024, ["--version"], 10_000);
    expect([
      result.timedOut ?? false,
      result.code,
      result.stdout.startsWith("git version"),
    ]).toEqual([false, 0, true]);
  });
});
