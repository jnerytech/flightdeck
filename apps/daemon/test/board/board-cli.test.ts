import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runBoardCli } from "../../src/board/board-cli.ts";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, stopAll } from "./card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

describe("flightdeckd board settings (issue #3454)", () => {
  test("without a flag it only reads the limit", async () => {
    const daemon = fakeDaemon({ "board.settings": () => ({ maxParallelRuns: 3 }) });
    const result = await runBoardCli({ action: "settings" }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(text(result)).toBe("max parallel runs: 3");
    expect(daemon.calls.filter((c) => c.type === "board.settings")).toEqual([
      { type: "board.settings", payload: {} },
    ]);
  });

  test("--max-parallel-runs sets the limit and says the new one", async () => {
    const daemon = fakeDaemon({
      "board.settings": (p) => ({ maxParallelRuns: p.maxParallelRuns ?? 3 }),
    });
    const result = await runBoardCli(
      { action: "settings", maxParallelRuns: 5 },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(text(result)).toBe("max parallel runs: 5");
    expect(daemon.calls.filter((c) => c.type === "board.settings")[0]?.payload).toEqual({
      maxParallelRuns: 5,
    });
  });

  test("--json prints the daemon's answer as one document", async () => {
    const daemon = fakeDaemon({ "board.settings": () => ({ maxParallelRuns: 2 }) });
    const result = await runBoardCli({ action: "settings", json: true }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).toStartWith("{");
    expect(JSON.parse(result.out.join("\n"))).toEqual({ maxParallelRuns: 2 });
  });

  test("a refusal exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "board.settings": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const result = await runBoardCli(
      { action: "settings", maxParallelRuns: 5 },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid: nope");
  });

  test("a change that got no answer says its result is unknown, a read does not", async () => {
    const silent = fakeDaemon({});
    const wrote = await runBoardCli(
      { action: "settings", maxParallelRuns: 5 },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(wrote.code).toBe(2);
    expect(text(wrote)).toContain("may or may not have been changed");
    const read = await runBoardCli({ action: "settings" }, config(silent.port), {
      timeoutMs: 200,
    });
    expect(read.code).toBe(2);
    expect(text(read)).not.toContain("may or may not");
  });
});

describe("the arguments of board settings (issue #3454)", () => {
  test("board settings takes --max-parallel-runs and --json", () => {
    expect(parsed(["board", "settings"])).toMatchObject({ command: "board", action: "settings" });
    expect(parsed(["board", "settings", "--max-parallel-runs", "5", "--json"])).toMatchObject({
      command: "board",
      action: "settings",
      maxParallelRuns: 5,
      json: true,
    });
  });

  test("the limit is a plain whole number of 1 or more", () => {
    for (const bad of ["0", "-1", "abc", "1e1", "0x5", " 3 ", "2.5", "", "99999999999999999999"])
      expect(parsed(["board", "settings", "--max-parallel-runs", bad])).toMatchObject({
        refusedWith: expect.stringContaining("--max-parallel-runs needs a whole number"),
      });
  });

  test("an action that does not exist, or a flag of another command, is refused", () => {
    expect(parsed(["board", "nope"])).toMatchObject({
      refusedWith: expect.stringContaining("invalid board action"),
    });
    expect(parsed(["card", "list", "--max-parallel-runs", "3"])).toMatchObject({
      refusedWith: expect.stringContaining("--max-parallel-runs"),
    });
  });
});
