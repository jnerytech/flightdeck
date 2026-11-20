import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runHistoryCli } from "../../src/history/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { poll } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

const changed = (over: Record<string, unknown> = {}) => ({
  type: "history.changed",
  claudeSessionId: "abc",
  cwd: "/work/app",
  lastTs: "2026-11-20T10:00:00.000Z",
  maybeActive: false,
  ...over,
});

/** Runs `history watch` once the daemon has it, then presses Ctrl-C when `lines` lines came. */
async function watched(
  daemon: ReturnType<typeof fakeDaemon>,
  options: { json?: boolean; lines?: number; after?: () => unknown } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runHistoryCli(
    { action: "watch", ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "history.watch"));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd history resume (issue #3461)", () => {
  test("it asks the daemon to resume the transcript and prints the new session", async () => {
    const daemon = fakeDaemon({ "history.resume": () => ({ sessionId: "s1" }) });
    const result = await runHistoryCli(
      { action: "resume", claudeSessionId: "abc" },
      config(daemon.port),
    );
    expect(result).toEqual({ code: 0, out: ["resumed as session s1"], err: [] });
    expect(daemon.calls.filter((c) => c.type === "history.resume")).toEqual([
      { type: "history.resume", payload: { claudeSessionId: "abc" } },
    ]);
  });

  test("a name, a permission mode and --force are sent only when typed", async () => {
    const daemon = fakeDaemon({ "history.resume": () => ({ sessionId: "s2" }) });
    await runHistoryCli(
      {
        action: "resume",
        claudeSessionId: "abc",
        name: "Fix login again",
        permissionMode: "acceptEdits",
        force: true,
      },
      config(daemon.port),
    );
    expect(daemon.calls.filter((c) => c.type === "history.resume")).toEqual([
      {
        type: "history.resume",
        payload: {
          claudeSessionId: "abc",
          name: "Fix login again",
          permissionMode: "acceptEdits",
          force: true,
        },
      },
    ]);
  });

  test("--json prints the daemon's answer", async () => {
    const daemon = fakeDaemon({ "history.resume": () => ({ sessionId: "s3" }) });
    const result = await runHistoryCli(
      { action: "resume", claudeSessionId: "abc", json: true },
      config(daemon.port),
    );
    expect(result.out).toEqual(['{"sessionId":"s3"}']);
  });

  test("a transcript that may be running elsewhere is refused with 1 and says how to go on", async () => {
    const daemon = fakeDaemon({
      "history.resume": () => ({
        error: {
          code: "invalid_state",
          message: "session possibly in use elsewhere; send force: true to resume anyway",
        },
      }),
    });
    const result = await runHistoryCli(
      { action: "resume", claudeSessionId: "abc" },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("session possibly in use elsewhere");
    expect(daemon.calls.filter((c) => c.type === "history.resume")).toHaveLength(1);
  });

  test("no answer exits 2 and says the session may or may not have been started", async () => {
    const silent = fakeDaemon({});
    const result = await runHistoryCli(
      { action: "resume", claudeSessionId: "abc" },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not have been started");
  });
});

describe("flightdeckd history watch (issue #3461)", () => {
  test("it writes a line for each change the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "history.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      lines: 2,
      after: () => {
        daemon.push(changed());
        daemon.push(changed({ claudeSessionId: "def", maybeActive: true, lastTs: null }));
      },
    });
    expect(lines).toEqual([
      "abc  2026-11-20T10:00:00.000Z  /work/app",
      "def  -  /work/app [may be running]",
    ]);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "history.watch")).toHaveLength(1);
  });

  test("--json writes one change per line, for a script", async () => {
    const daemon = fakeDaemon({ "history.watch": () => ({}) });
    const { lines } = await watched(daemon, { json: true, after: () => daemon.push(changed()) });
    expect(lines).toEqual([
      '{"claudeSessionId":"abc","cwd":"/work/app","lastTs":"2026-11-20T10:00:00.000Z","maybeActive":false}',
    ]);
  });

  test("a folder name cannot drive the terminal", async () => {
    const daemon = fakeDaemon({ "history.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      after: () => daemon.push(changed({ cwd: "/work/a\u001b[2Jb" })),
    });
    expect(lines).toEqual(["abc  2026-11-20T10:00:00.000Z  /work/a [2Jb"]);
  });

  test("a refused watch exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "history.watch": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const { result } = await watched(daemon, { lines: 0 });
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("invalid: nope");
  });

  test("a daemon that goes away mid-stream exits 2, after what it had written", async () => {
    const daemon = fakeDaemon({ "history.watch": () => ({}) });
    const lines: string[] = [];
    let code: number | undefined;
    void runHistoryCli({ action: "watch" }, config(daemon.port), {
      timeoutMs: 2000,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    }).then((r) => {
      code = r.code;
    });
    await poll(() => daemon.calls.some((c) => c.type === "history.watch"));
    daemon.push(changed());
    await poll(() => lines.length === 1);
    daemon.dropAll();
    await poll(() => code !== undefined);
    expect(code).toBe(2);
  });
});

describe("the arguments of history resume and watch (issue #3461)", () => {
  test("resume takes the session, a name, a permission mode, --force and --json", () => {
    expect(parsed(["history", "resume", "abc"])).toMatchObject({
      command: "history",
      action: "resume",
      claudeSessionId: "abc",
    });
    expect(
      parsed([
        "history",
        "resume",
        "abc",
        "--name",
        "Fix login again",
        "--permission-mode",
        "acceptEdits",
        "--force",
        "--json",
      ]),
    ).toMatchObject({
      action: "resume",
      claudeSessionId: "abc",
      personaName: "Fix login again",
      permissionMode: "acceptEdits",
      force: true,
      json: true,
    });
  });

  test("resume needs the session, and a bad permission mode is refused", () => {
    expect(parsed(["history", "resume"])).toMatchObject({
      refusedWith: expect.stringContaining("missing the session"),
    });
    expect(parsed(["history", "resume", "abc", "--permission-mode", "yolo"])).toMatchObject({
      refusedWith: expect.stringContaining("--permission-mode: "),
    });
  });

  test("watch takes --json and nothing else", () => {
    expect(parsed(["history", "watch"])).toMatchObject({ command: "history", action: "watch" });
    expect(parsed(["history", "watch", "--json"])).toMatchObject({ action: "watch", json: true });
    expect(parsed(["history", "watch", "--cwd", "/x"])).toMatchObject({
      refusedWith: expect.stringContaining("--cwd: this flag only applies"),
    });
  });

  test("a flag of resume is refused on the other verbs", () => {
    const refused: Array<[string[], string]> = [
      [["history", "list", "--force"], "--force"],
      [["history", "get", "abc", "--name", "x"], "--name"],
      [["history", "watch", "--permission-mode", "plan"], "--permission-mode"],
      [["history", "watch", "--force"], "--force"],
    ];
    for (const [argv, flag] of refused)
      expect(parsed(argv)).toMatchObject({
        refusedWith: expect.stringContaining(`${flag}: this flag only applies`),
      });
  });

  test("resume refuses the filters of list", () => {
    expect(parsed(["history", "resume", "abc", "--cwd", "/x"])).toMatchObject({
      refusedWith: expect.stringContaining("--cwd: this flag only applies"),
    });
  });

  test("--force, --name and --permission-mode keep their other owners", () => {
    expect(parsed(["card", "move", "c1", "review", "--force"])).toMatchObject({ force: true });
    expect(parsed(["persona", "list", "--force"])).toMatchObject({
      refusedWith: expect.stringContaining("--force: this flag only applies"),
    });
    expect(parsed(["persona", "list", "--name", "x"])).toMatchObject({
      refusedWith: expect.stringContaining("--name: this flag only applies"),
    });
  });
});

describe("history resume and watch through the command line (issue #3461)", () => {
  test("resume runs through flightdeckd and prints the session", async () => {
    const daemon = fakeDaemon({ "history.resume": () => ({ sessionId: "s9" }) });
    const run = await flightdeckd(["history", "resume", "abc", "--force"], daemon.port);
    expect(run.out).toEqual(["resumed as session s9"]);
    expect(daemon.calls.filter((c) => c.type === "history.resume")).toEqual([
      { type: "history.resume", payload: { claudeSessionId: "abc", force: true } },
    ]);
  });

  test("watch runs through flightdeckd until its Ctrl-C handler runs", async () => {
    const daemon = fakeDaemon({ "history.watch": () => ({}) });
    const handlers: Array<() => unknown> = [];
    const running = flightdeckd(["history", "watch"], daemon.port, undefined, {
      onSignal: (_signal: string, handler: () => unknown) => handlers.push(handler),
    } as never);
    await poll(() => daemon.calls.some((c) => c.type === "history.watch"));
    daemon.push(changed());
    await poll(() => handlers.length > 0);
    for (const handler of handlers) await handler();
    const run = await running;
    expect(run.out).toEqual(["abc  2026-11-20T10:00:00.000Z  /work/app"]);
  });
});
