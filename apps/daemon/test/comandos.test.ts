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
});
