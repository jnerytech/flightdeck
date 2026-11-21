import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runExternalCli } from "../../src/central/index.ts";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { watchedCli } from "../support/cli-watch.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/** An external session as `external.list` answers it: with the transcript, the launch and the last prompt. */
const EXT1 = {
  claudeSessionId: "ext-1",
  cwd: "/work/api",
  transcriptPath: "/home/u/.claude/projects/api/ext-1.jsonl",
  source: "startup",
  status: "running",
  statusReason: null,
  launchId: "launch-secret-1",
  controllable: true,
  projectKey: "api",
  startedAt: "2026-11-21T09:00:00.000Z",
  lastEventAt: "2026-11-21T10:00:00.000Z",
  endedAt: null,
  meta: { name: "api work", pinned: false, archived: false },
  summary: { request: "fix the failing tests", state: "running", tool: "Bash", since: null },
  permissionMode: "default",
};
const EXT2 = {
  claudeSessionId: "ext-2",
  cwd: null,
  transcriptPath: null,
  source: null,
  status: "awaiting_permission",
  statusReason: "Bash",
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-21T08:00:00.000Z",
  lastEventAt: "2026-11-21T08:30:00.000Z",
  endedAt: null,
};

const ROW1 = {
  claudeSessionId: "ext-1",
  name: "api work",
  cwd: "/work/api",
  status: "running",
  statusReason: null,
  controllable: true,
  source: "startup",
  projectKey: "api",
  permissionMode: "default",
  waiting: null,
  startedAt: "2026-11-21T09:00:00.000Z",
  lastEventAt: "2026-11-21T10:00:00.000Z",
  endedAt: null,
};
const ROW2 = {
  claudeSessionId: "ext-2",
  name: null,
  cwd: null,
  status: "awaiting_permission",
  statusReason: "Bash",
  controllable: false,
  source: null,
  projectKey: null,
  permissionMode: null,
  waiting: null,
  startedAt: "2026-11-21T08:00:00.000Z",
  lastEventAt: "2026-11-21T08:30:00.000Z",
  endedAt: null,
};

const OPEN: Handlers = {
  "external.list": () => ({ sessions: [EXT1, EXT2] }),
  "external.message": () => ({}),
  "external.watch": () => ({}),
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd external list (issue #3735)", () => {
  test("one line each: the id, the name, how it stands, whether it takes a message, the folder and the last event", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["external", "list"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "2 external sessions",
        "  ext-1 api work, running, controllable, /work/api, last event 2026-11-21T10:00:00.000Z",
        "  ext-2 (unnamed), awaiting_permission (Bash), not controllable, no folder, last event 2026-11-21T08:30:00.000Z",
      ],
      err: [],
    });
    expect(callsOf(daemon, "external.list")).toEqual([{}]);
  });

  test("--json prints a small stable row each, null for what is missing, never the transcript, the launch or the prompt", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["external", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual([ROW1, ROW2]);
    const text = run.out.join("\n");
    for (const secret of ["transcript", "launch-secret", "fix the failing tests", "launchId"])
      expect(text).not.toContain(secret);
  });

  test("none is an empty list and exit 0", async () => {
    const daemon = fakeDaemon({ "external.list": () => ({ sessions: [] }) });
    const text = await flightdeckd(["external", "list"], daemon.port);
    const json = await flightdeckd(["external", "list", "--json"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["no external sessions"] });
    expect({ code: json.code, out: printed(json.out) }).toEqual({ code: 0, out: [] });
  });

  test("a closed connection is exit 2, and a session name cannot drive the terminal", async () => {
    const gone = fakeDaemon({ "external.list": () => CLOSE });
    const hostile = fakeDaemon({
      "external.list": () => ({
        sessions: [{ ...EXT1, meta: { name: "\u001b[2Jwiped", pinned: false, archived: false } }],
      }),
    });
    expect((await flightdeckd(["external", "list"], gone.port)).code).toBe(2);
    const run = await flightdeckd(["external", "list"], hostile.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd external message (issue #3735)", () => {
  test("it sends the text to the session and says so, with --json too", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["external", "message", "ext-1", "--text", "go on"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["sent to ext-1"],
      err: [],
    });
    expect(callsOf(daemon, "external.message")).toEqual([
      { claudeSessionId: "ext-1", text: "go on" },
    ]);
    const json = await flightdeckd(
      ["external", "message", "ext-1", "--text", "go on", "--json"],
      daemon.port,
    );
    expect(printed(json.out)).toEqual({ session: "ext-1", sent: true });
  });

  test("an unknown session and a session with no channel are exit 1 with the daemon's text", async () => {
    const missing = fakeDaemon({
      "external.message": () => ({
        error: { code: "not_found", message: "session ext-9 does not exist" },
      }),
    });
    const blind = fakeDaemon({
      "external.message": () => ({
        error: {
          code: "invalid_state",
          message:
            "session has no channel: only sessions opened with flightdeckd claude receive messages",
        },
      }),
    });
    const a = await flightdeckd(["external", "message", "ext-9", "--text", "hi"], missing.port);
    const b = await flightdeckd(["external", "message", "ext-2", "--text", "hi"], blind.port);
    expect([a.code, b.code]).toEqual([1, 1]);
    expect(a.err.join("\n")).toContain("session ext-9 does not exist");
    expect(b.err.join("\n")).toContain("only sessions opened with flightdeckd claude");
  });

  test("an empty text is exit 1 and connects to nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["external", "message", "ext-1", "--text", ""], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("--text: the message cannot be empty");
    expect(daemon.calls).toEqual([]);
  });

  test("a connection that closes after the text went says it may or may not have arrived, exit 2", async () => {
    const daemon = fakeDaemon({ "external.message": () => CLOSE });
    const run = await flightdeckd(["external", "message", "ext-1", "--text", "hi"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not have");
  });
});

const watching = (
  daemon: ReturnType<typeof fakeDaemon>,
  options: Parameters<typeof watchedCli>[3] & { json?: boolean },
) =>
  watchedCli(
    daemon,
    "external.watch",
    (cfg, run) =>
      runExternalCli({ action: "watch", ...(options.json ? { json: true } : {}) }, cfg, run),
    options,
  );

describe("flightdeckd external watch (issue #3735)", () => {
  test("it writes a line for each session the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "external.watch": () => ({}) });
    const { result, lines } = await watching(daemon, {
      lines: 2,
      after: () => {
        daemon.push({ type: "external.updated", session: EXT1 });
        daemon.push({ type: "external.updated", session: EXT2 });
      },
    });
    expect(lines).toEqual([
      "ext-1 api work, running, controllable, /work/api, last event 2026-11-21T10:00:00.000Z",
      "ext-2 (unnamed), awaiting_permission (Bash), not controllable, no folder, last event 2026-11-21T08:30:00.000Z",
    ]);
    expect(result.code).toBe(0);
    expect(callsOf(daemon, "external.watch")).toEqual([{}]);
  });

  test("--json writes one row per line, as list does", async () => {
    const daemon = fakeDaemon({ "external.watch": () => ({}) });
    const { lines } = await watching(daemon, {
      json: true,
      after: () => daemon.push({ type: "external.updated", session: EXT1 }),
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([ROW1]);
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({});
    const lines: string[] = [];
    const { config } = await import("../board/card-cli-helpers.ts");
    const result = await runExternalCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 200,
      signal: new AbortController().signal,
      write: (line) => lines.push(line),
    });
    expect(result.code).toBe(2);
    expect(lines).toEqual([]);
  });
});

describe("flightdeckd external words (issue #3735)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`external list|watch` and `external message <id> --text <text>`, with --host and --json", () => {
    expect(argsOf(["external", "list"])).toMatchObject({ command: "external", action: "list" });
    expect(argsOf(["external", "watch", "--host", "pi", "--json"])).toMatchObject({
      command: "external",
      action: "watch",
      host: "pi",
      json: true,
    });
    expect(argsOf(["external", "message", "ext-1", "--text", "go on"])).toMatchObject({
      command: "external",
      action: "message",
      externalSession: "ext-1",
      text: "go on",
    });
  });

  test("a missing verb, session or text, and a flag that is not the verb's, are refused", () => {
    const refused = (argv: string[]) => (argsOf(argv) as { refusedWith?: string }).refusedWith;
    expect(refused(["external"])).toContain("invalid external action");
    expect(refused(["external", "frobnicate"])).toContain("invalid external action");
    expect(refused(["external", "message"])).toContain("the session");
    expect(refused(["external", "message", "ext-1"])).toContain("missing --text");
    expect(refused(["external", "list", "--text", "x"])).toContain("--text");
  });
});
