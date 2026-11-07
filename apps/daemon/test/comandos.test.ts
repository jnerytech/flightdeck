import { afterEach, describe, expect, test } from "bun:test";
import { runCommand } from "../src/board/command.ts";
import { tempDir } from "./helpers.ts";

afterEach(() => {
  delete process.env.FD_PROBE;
});

describe("comandos", () => {
  test("filhos recebem o ambiente atual do daemon, não o da partida", async () => {
    // Bun.spawn without `env` passes the environment the process started with, which skips
    // whatever changed later (the test guards on PATH and HOME, for one).
    process.env.FD_PROBE = "ambiente atual";
    const result = await runCommand(
      [process.execPath, "-e", "process.stdout.write(process.env.FD_PROBE ?? '')"],
      tempDir(),
    );
    expect(result).toEqual({ code: 0, stdout: "ambiente atual", stderr: "" });
  });

  test("a signal that fires kills the command and says so, without waiting for its time", async () => {
    const stop = new AbortController();
    const running = runCommand(
      [process.execPath, "-e", "setTimeout(() => {}, 1500)"],
      tempDir(),
      undefined,
      30_000,
      undefined,
      {},
      stop.signal,
    );
    setTimeout(() => stop.abort(), 100);
    const result = await running;
    expect([result.aborted, result.code === 0]).toEqual([true, false]);
  });

  test("a signal that fired before the command started kills it at once", async () => {
    const result = await runCommand(
      [process.execPath, "-e", "setTimeout(() => {}, 1500)"],
      tempDir(),
      undefined,
      30_000,
      undefined,
      {},
      AbortSignal.abort(),
    );
    expect([result.aborted, result.code === 0]).toEqual([true, false]);
  });
});
