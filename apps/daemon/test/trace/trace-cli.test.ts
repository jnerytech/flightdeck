import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const node = (over: Record<string, unknown>) => ({
  n: null,
  label: null,
  input: null,
  result: null,
  startMs: null,
  durationMs: null,
  costUsd: null,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  error: false,
  children: [],
  ...over,
});

const TRACE = {
  claudeSessionId: "s1",
  costUsd: 0.42,
  durationMs: 12_500,
  costliest: "turn 2",
  slowest: "tool:t9",
  turns: [
    node({
      id: "turn:1",
      kind: "turn",
      name: "turn",
      n: 1,
      label: "Fix the parser",
      durationMs: 2000,
      costUsd: 0.1,
      children: [
        node({
          id: "tool:t1",
          kind: "tool",
          name: "Bash",
          durationMs: 500,
          error: true,
          children: [
            node({ id: "agent:a1", kind: "subagent", name: "Explore", label: "Look around" }),
          ],
        }),
      ],
    }),
    node({
      id: "turn:2",
      kind: "turn",
      name: "turn",
      n: 2,
      label: "Add tests",
      durationMs: 10_500,
      costUsd: 0.32,
    }),
  ],
};

const EXPORT = {
  filename: "trace-s1.json",
  json: JSON.stringify({ claudeSessionId: "s1", turns: [{ id: "turn:1" }] }),
  redacted: 0,
};

const OPEN: Handlers = { "trace.get": () => TRACE, "trace.export": () => EXPORT };

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd trace get (issue #3701)", () => {
  test("the header says what cost most and took longest, then the tree, one line a node", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["trace", "get", "s1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "s1: $0.42, 12.5 s",
        "costliest: turn 2",
        "slowest: tool:t9",
        'turn 1 "Fix the parser" 2.0 s, $0.10',
        "  tool Bash 0.5 s, error",
        '    subagent Explore "Look around"',
        'turn 2 "Add tests" 10.5 s, $0.32',
      ],
      err: [],
    });
    expect(callsOf(daemon, "trace.get")).toEqual([{ claudeSessionId: "s1" }]);
  });

  test("--json prints the whole trace the daemon built", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["trace", "get", "s1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual(TRACE);
  });

  test("a session with no turn says so, and a prompt cannot drive the terminal", async () => {
    const empty = fakeDaemon({
      ...OPEN,
      "trace.get": () => ({ ...TRACE, turns: [], costUsd: null, durationMs: null }),
    });
    const none = await flightdeckd(["trace", "get", "s1"], empty.port);
    expect(none.out).toEqual(["s1: no turn yet"]);
    const hostile = fakeDaemon({
      ...OPEN,
      "trace.get": () => ({
        ...TRACE,
        turns: [node({ id: "turn:1", kind: "turn", name: "turn", n: 1, label: "a\u001b[2Jwiped" })],
      }),
    });
    const run = await flightdeckd(["trace", "get", "s1"], hostile.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a refusal is exit 1 with the daemon's words; a closed connection is exit 2", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "trace.get": () => ({
        error: { code: "not_found", message: "no transcript for this session" },
      }),
    });
    const gone = fakeDaemon({ ...OPEN, "trace.get": () => CLOSE });
    const refused = await flightdeckd(["trace", "get", "nope"], refusing.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("no transcript for this session");
    expect((await flightdeckd(["trace", "get", "s1"], gone.port)).code).toBe(2);
  });
});

describe("flightdeckd trace export (issue #3701)", () => {
  test("stdout is the file, as JSON; the content flag is sent only when typed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["trace", "export", "s1"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(printed(run.out)).toEqual({
      claudeSessionId: "s1",
      turns: [{ id: "turn:1" }],
    });
    await flightdeckd(["trace", "export", "s1", "--include-content"], daemon.port);
    expect(callsOf(daemon, "trace.export")).toEqual([
      { claudeSessionId: "s1" },
      { claudeSessionId: "s1", includeContent: true },
    ]);
  });

  test("how many fields were replaced for holding a secret goes to stderr, never into the file", async () => {
    const daemon = fakeDaemon({ ...OPEN, "trace.export": () => ({ ...EXPORT, redacted: 3 }) });
    const run = await flightdeckd(["trace", "export", "s1", "--include-content"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      claudeSessionId: "s1",
      turns: [{ id: "turn:1" }],
    });
    expect(run.err.join("\n")).toContain("3 fields");
  });

  test("--json wraps the file name, the file's text and the count", async () => {
    const daemon = fakeDaemon({ ...OPEN, "trace.export": () => ({ ...EXPORT, redacted: 1 }) });
    const run = await flightdeckd(["trace", "export", "s1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ ...EXPORT, redacted: 1 });
  });

  test("a file that is not JSON is refused instead of printed", async () => {
    const daemon = fakeDaemon({ ...OPEN, "trace.export": () => ({ ...EXPORT, json: "{oops" }) });
    const run = await flightdeckd(["trace", "export", "s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("not valid JSON");
  });
});

describe("flightdeckd trace words (issue #3701)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`trace get <id>` and `trace export <id> [--include-content]`", () => {
    expect(argsOf(["trace", "get", "s1", "--json"])).toMatchObject({
      command: "trace",
      action: "get",
      checkpointSession: "s1",
      json: true,
    });
    expect(argsOf(["trace", "export", "s1", "--include-content"])).toMatchObject({
      command: "trace",
      action: "export",
      includeContent: true,
    });
  });

  test("a missing id, an unknown verb and --include-content on another command are refused", () => {
    expect(JSON.stringify(argsOf(["trace", "get"]))).toContain("missing the Claude session id");
    expect(JSON.stringify(argsOf(["trace", "remove", "s1"]))).toContain("invalid trace action");
    expect(JSON.stringify(argsOf(["trace", "get", "s1", "--include-content"]))).toContain(
      "--include-content",
    );
    expect(JSON.stringify(argsOf(["snapshots", "list", "s1", "--include-content"]))).toContain(
      "--include-content",
    );
  });
});
