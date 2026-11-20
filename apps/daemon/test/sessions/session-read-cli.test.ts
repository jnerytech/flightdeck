import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runSessionCli } from "../../src/sessions/index.ts";
import { CLOSE, config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SESSIONS = {
  sessions: [
    { id: "s1", name: "fd-qa", claudeSessionId: "c-111" },
    { id: "s2", name: "twin", claudeSessionId: "c-222" },
    { id: "s3", name: "twin", claudeSessionId: "c-333" },
    { id: "s4", name: null, claudeSessionId: null },
  ],
};

const RECAP = {
  asked: "run the suite",
  done: "the suite passes",
  files: ["src/a.ts", "src/b.ts"],
  filesMore: 3,
  costUsd: 1.5,
  question: null,
  state: "idle",
  source: "transcript",
};

const INTERRUPTED = {
  sessionId: "s7",
  name: "fd-dev",
  cwd: "/work/app",
  persona: "developer",
  interruptedAt: "2026-11-20T09:00:00Z",
  ranMs: 125_000,
  lastRequest: "fix the build",
};

const OPEN: Handlers = {
  "session.list": () => SESSIONS,
  "session.interrupted": () => ({ sessions: [INTERRUPTED] }),
  "session.summary": () => RECAP,
  "session.files": () => ({
    files: [
      {
        path: "src/a.ts",
        edits: 4,
        firstAt: "2026-11-20T08:00:00Z",
        lastAt: "2026-11-20T08:30:00Z",
      },
    ],
  }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd session interrupted (issue #3514)", () => {
  test("a session a restart interrupted is one line: its name, folder, run time and last request", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "interrupted"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["fd-dev  /work/app  ran 2m 5s  interrupted 2026-11-20T09:00:00Z  last: fix the build"],
      err: [],
    });
    expect(callsOf(daemon, "session.interrupted")).toEqual([{}]);
  });

  test("--json prints the sessions as the protocol returns them, with null for a missing field", async () => {
    const bare = { ...INTERRUPTED, name: null, persona: null, lastRequest: null };
    const daemon = fakeDaemon({ ...OPEN, "session.interrupted": () => ({ sessions: [bare] }) });
    const run = await flightdeckd(["session", "interrupted", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ sessions: [bare] });
  });

  test("with none it says so, and --json prints an empty list", async () => {
    const daemon = fakeDaemon({ ...OPEN, "session.interrupted": () => ({ sessions: [] }) });
    const text = await flightdeckd(["session", "interrupted"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["no interrupted session"],
    });
    const asJson = await flightdeckd(["session", "interrupted", "--json"], daemon.port);
    expect(JSON.parse(asJson.out.join("\n"))).toEqual({ sessions: [] });
  });

  test("a request that carries terminal controls is printed without them", async () => {
    const hostile = { ...INTERRUPTED, lastRequest: "ok\u001b[2Jgone\u202ex" };
    const daemon = fakeDaemon({ ...OPEN, "session.interrupted": () => ({ sessions: [hostile] }) });
    const run = await flightdeckd(["session", "interrupted"], daemon.port);
    expect(run.out.join("\n")).toContain("last: ok [2Jgone x");
  });
});

describe("flightdeckd session summary (issue #3514)", () => {
  test("a session by name asks for the recap of its Claude session and prints what it asked and did", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "summary", "fd-qa"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "state: idle",
      "asked: run the suite",
      "done: the suite passes",
      "files: src/a.ts, src/b.ts (3 more)",
      "cost: $1.50",
    ]);
    expect(callsOf(daemon, "session.summary")).toEqual([{ claudeSessionId: "c-111" }]);
  });

  test("a recap with nothing yet says dashes, never the word null", async () => {
    const empty = { ...RECAP, asked: null, done: null, files: [], filesMore: 0, costUsd: null };
    const daemon = fakeDaemon({ ...OPEN, "session.summary": () => empty });
    const run = await flightdeckd(["session", "summary", "s1"], daemon.port);
    expect(run.out).toEqual(["state: idle", "asked: -", "done: -", "files: -", "cost: -"]);
  });

  test("--json prints the recap as the protocol returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "summary", "s1", "--json"], daemon.port);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual(RECAP);
  });

  test("a session with no Claude session id yet is refused and nothing is asked", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "summary", "s4"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("s4 has no Claude session yet");
    expect(callsOf(daemon, "session.summary")).toEqual([]);
  });

  test("a session that does not exist, or a name two sessions share, is refused with the ids", async () => {
    const daemon = fakeDaemon(OPEN);
    const none = await flightdeckd(["session", "summary", "nobody"], daemon.port);
    expect(none.code).toBe(1);
    expect(none.err.join("\n")).toContain("no such session: nobody");
    const twin = await flightdeckd(["session", "summary", "twin"], daemon.port);
    expect(twin.code).toBe(1);
    expect(twin.err.join("\n")).toContain("2 sessions are named twin: use an id (s2, s3)");
    expect(callsOf(daemon, "session.summary")).toEqual([]);
  });

  test("the daemon's refusal is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.summary": () => ({ error: { code: "not_found", message: "no transcript" } }),
    });
    const run = await flightdeckd(["session", "summary", "s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("no transcript");
  });

  test("a read with no answer exits 2 and never says it may have changed something", async () => {
    const daemon = fakeDaemon({ ...OPEN, "session.summary": () => undefined });
    const result = await runSessionCli({ action: "summary", session: "s1" }, config(daemon.port), {
      timeoutMs: 300,
    });
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).not.toContain("may or may not");
  });
});

describe("flightdeckd session files (issue #3514)", () => {
  test("a session's files are one line each: the path, the edits and the last edit", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "files", "fd-qa"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["src/a.ts  4 edits  last 2026-11-20T08:30:00Z"],
    });
    expect(callsOf(daemon, "session.files")).toEqual([{ claudeSessionId: "c-111" }]);
  });

  test("one edit is said in the singular, and a session with no file says so", async () => {
    const one = fakeDaemon({
      ...OPEN,
      "session.files": () => ({
        files: [
          { path: "a", edits: 1, firstAt: "2026-11-20T08:00:00Z", lastAt: "2026-11-20T08:00:00Z" },
        ],
      }),
    });
    expect((await flightdeckd(["session", "files", "s1"], one.port)).out).toEqual([
      "a  1 edit  last 2026-11-20T08:00:00Z",
    ]);
    const none = fakeDaemon({ ...OPEN, "session.files": () => ({ files: [] }) });
    expect((await flightdeckd(["session", "files", "s1"], none.port)).out).toEqual([
      "no file edited",
    ]);
  });

  test("--json prints the files as the protocol returns them", async () => {
    const files = [
      {
        path: "src/a.ts",
        edits: 4,
        firstAt: "2026-11-20T08:00:00Z",
        lastAt: "2026-11-20T08:30:00Z",
      },
    ];
    const daemon = fakeDaemon({ ...OPEN, "session.files": () => ({ files }) });
    const run = await flightdeckd(["session", "files", "s1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ files });
  });
});

describe("flightdeckd session, as the terminal runs it (issue #3514)", () => {
  test("a daemon that closes before it answers exits 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "session.interrupted": () => CLOSE });
    const run = await flightdeckd(["session", "interrupted"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("no daemon at the address of the config: exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["session", "interrupted"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });
});

describe("the arguments of session (issue #3514)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("each verb is read with its session, --json and --host", () => {
    expect(parsed(["session", "interrupted", "--json"])).toMatchObject({
      command: "session",
      action: "interrupted",
      json: true,
    });
    expect(parsed(["session", "summary", "fd-qa", "--host", "pi"])).toMatchObject({
      command: "session",
      action: "summary",
      sessionRef: "fd-qa",
      host: "pi",
    });
    expect(parsed(["session", "files", "s1"])).toMatchObject({ action: "files", sessionRef: "s1" });
  });

  test("a missing verb or session is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["session"]))).toContain("invalid session action");
    expect(JSON.stringify(parsed(["session", "bogus"]))).toContain("invalid session action");
    expect(JSON.stringify(parsed(["session", "summary"]))).toContain("missing the session");
    expect(JSON.stringify(parsed(["session", "files", "--json"]))).toContain("missing the session");
  });

  test("a verb that reads no session is refused when it is given one, so a typo cannot pass", () => {
    expect(JSON.stringify(parsed(["session", "interrupted", "s1"]))).toContain(
      "unknown argument: s1",
    );
  });

  test("a second command word after another command is refused", () => {
    expect(JSON.stringify(parsed(["session", "files", "s1", "send", "s1", "x"]))).toContain(
      "one command at a time",
    );
  });
});
