import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runBoardCli } from "../../src/board/board-cli.ts";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { poll } from "../support/helpers.ts";
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

/** A card as the daemon pushes it: the protocol checks every frame, so it must be whole. */
const card = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  projectId: "p1",
  slug: "c1",
  title: "Fix the login",
  description: "",
  column: "in_progress",
  columnLocked: false,
  position: 0,
  queued: false,
  queueReason: null,
  quotaUntil: null,
  branch: null,
  worktreePath: "/w/c1",
  prUrl: null,
  prState: null,
  checksState: null,
  sessionId: null,
  sessionStatus: null,
  notice: null,
  waitingOn: [],
  discarded: false,
  runs: [],
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-20T00:00:00Z",
  ...over,
});
const updated = (over: Record<string, unknown> = {}) => ({
  type: "card.updated",
  card: card(over),
});

/** Runs `board watch` once the daemon has it, then presses Ctrl-C when `lines` lines came. */
async function watched(
  daemon: ReturnType<typeof fakeDaemon>,
  options: { json?: boolean; timeoutMs?: number; lines?: number; after?: () => unknown } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runBoardCli(
    { action: "watch", ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: options.timeoutMs ?? 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "board.watch"));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd board watch (issue #3454)", () => {
  test("it writes a line for each card the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "board.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      lines: 2,
      after: () => {
        daemon.push(updated());
        daemon.push(updated({ id: "c2", title: "Add a test", column: "review" }));
      },
    });
    expect(lines).toEqual(["c1  in_progress  Fix the login", "c2  review  Add a test"]);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "board.watch")).toHaveLength(1);
  });

  test("--json writes one card per line, for a script", async () => {
    const daemon = fakeDaemon({ "board.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      json: true,
      after: () => daemon.push(updated()),
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ id: "c1", title: "Fix the login" });
  });

  test("the time limit covers the connect and the ack, not the stream", async () => {
    const daemon = fakeDaemon({ "board.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      timeoutMs: 300,
      after: async () => {
        const past = Date.now() + 600;
        await poll(() => Date.now() > past); // longer than the limit of 300 ms
        daemon.push(updated());
      },
    });
    expect(lines).toEqual(["c1  in_progress  Fix the login"]);
    expect(result.code).toBe(0);
  });

  test("a frame the daemon pushes before the ack is not lost", async () => {
    const daemon = fakeDaemon({
      "board.watch": (_payload, ctx) => {
        ctx.push(updated());
        return {};
      },
    });
    const { lines } = await watched(daemon);
    expect(lines).toEqual(["c1  in_progress  Fix the login"]);
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({});
    const lines: string[] = [];
    const result = await runBoardCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 200,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    });
    expect(result.code).toBe(2);
    expect(text(result)).toContain("did not answer");
    expect(text(result)).not.toContain("may or may not");
    expect(lines).toEqual([]);
  });

  test("a refused watch exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "board.watch": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const { result } = await watched(daemon, { lines: 0 });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid: nope");
  });

  test("a daemon that goes away mid-stream exits 2, after what it had written", async () => {
    const daemon = fakeDaemon({ "board.watch": () => ({}) });
    const lines: string[] = [];
    let result: CliResult | undefined;
    void runBoardCli({ action: "watch" }, config(daemon.port), {
      timeoutMs: 2000,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    }).then((r) => {
      result = r;
    });
    await poll(() => daemon.calls.some((c) => c.type === "board.watch"));
    daemon.push(updated());
    await poll(() => lines.length === 1);
    daemon.dropAll();
    await poll(() => result);
    expect(lines).toEqual(["c1  in_progress  Fix the login"]);
    expect(result?.code).toBe(2);
    expect(text(result ?? { code: 0, out: [], err: [] })).toContain("could not reach the daemon");
  });

  test("the token never reaches a streamed line", async () => {
    const daemon = fakeDaemon({ "board.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      after: () => daemon.push(updated({ title: `leak ${config(daemon.port).token} end` })),
    });
    expect(lines).toEqual(["c1  in_progress  leak [token] end"]);
  });

  test("a card's title cannot drive the terminal", async () => {
    const daemon = fakeDaemon({ "board.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      after: () => daemon.push(updated({ title: "a\u001b[2Jb" })),
    });
    expect(lines).toEqual(["c1  in_progress  a [2Jb"]);
  });
});

describe("the arguments of board watch (issue #3454)", () => {
  test("board watch takes --json", () => {
    expect(parsed(["board", "watch"])).toMatchObject({ command: "board", action: "watch" });
    expect(parsed(["board", "watch", "--json"])).toMatchObject({ action: "watch", json: true });
  });

  test("the limit flag belongs to settings only", () => {
    expect(parsed(["board", "watch", "--max-parallel-runs", "3"])).toMatchObject({
      refusedWith: expect.stringContaining("--max-parallel-runs"),
    });
  });
});
