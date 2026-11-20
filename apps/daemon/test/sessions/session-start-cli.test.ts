import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runSessionCli, type SessionCliArgs } from "../../src/sessions/index.ts";
import { config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { type CliRun, flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SESSIONS = {
  sessions: [
    { id: "s1", name: "fd-qa", claudeSessionId: "c-111" },
    { id: "s2", name: "twin", claudeSessionId: "c-222" },
    { id: "s3", name: "twin", claudeSessionId: "c-333" },
  ],
};

const REVIEWER = { id: "reviewer", name: "Reviewer", icon: null };

const OPEN: Handlers = {
  "session.list": () => SESSIONS,
  "session.create": () => ({ sessionId: "s9" }),
  "session.setMode": () => ({}),
  "session.fork": () => ({ claudeSessionId: "c-new", sessionId: "s9" }),
  "session.applyPersona": () => ({ persona: REVIEWER, text: "You are Reviewer", delivery: "sent" }),
  "session.clearPersona": () => ({ persona: REVIEWER, text: "Back to normal", delivery: "sent" }),
};

/** The one JSON value a command printed; when it did not exit 0, what it did instead, so the check fails on the value. */
const jsonOf = (run: CliRun): unknown =>
  run.code === 0 && run.out.length > 0
    ? JSON.parse(run.out.join("\n"))
    : { code: run.code, out: run.out, err: run.err };

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const typesOf = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type !== "hello").map((c) => c.type);

describe("flightdeckd session create (issue #3514)", () => {
  test("every option goes to the daemon as typed, accents and emoji included, and the new id is said", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "session",
        "create",
        "--cwd",
        "/work/app",
        "--prompt",
        "revise a ação 🚀",
        "--name",
        "revisão",
        "--model",
        "opus",
        "--effort",
        "high",
        "--permission-mode",
        "plan",
        "--persona",
        "reviewer",
        "--language",
        "en",
      ],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["started session s9"],
      err: [],
    });
    expect(callsOf(daemon, "session.create")).toEqual([
      {
        cwd: "/work/app",
        prompt: "revise a ação 🚀",
        name: "revisão",
        model: "opus",
        effort: "high",
        permissionMode: "plan",
        persona: { id: "reviewer", language: "en" },
      },
    ]);
  });

  test("with only a folder, nothing else is sent, and no session is looked up", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "create", "--cwd", "/work/app"], daemon.port);
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "session.create")).toEqual([{ cwd: "/work/app" }]);
    expect(typesOf(daemon)).toEqual(["session.create"]);
  });

  test("a persona with no language sends the id alone", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["session", "create", "--cwd", "/work/app", "--persona", "reviewer"],
      daemon.port,
    );
    expect(callsOf(daemon, "session.create")).toEqual([
      { cwd: "/work/app", persona: { id: "reviewer" } },
    ]);
  });

  test("--json prints the new session and the action", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["session", "create", "--cwd", "/work/app", "--json"],
      daemon.port,
    );
    expect(jsonOf(run)).toEqual({ session: "s9", action: "create" });
  });

  test("a folder outside the allowed roots is exit 1 with the daemon's text, and nothing on stdout", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.create": () => ({
        error: { code: "forbidden_cwd", message: "/etc is outside the roots" },
      }),
    });
    const run = await flightdeckd(["session", "create", "--cwd", "/etc"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("/etc is outside the roots");
  });

  test("no answer is exit 2, and it says a session may or may not have been started", async () => {
    const silent = fakeDaemon({ ...OPEN, "session.create": () => undefined });
    const result = await runSessionCli(
      { action: "create", start: { cwd: "/work/app" } },
      config(silent.port),
      { timeoutMs: 300 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain(
      "a session may or may not have been started: check with `sessions` before trying again",
    );
  });
});

describe("flightdeckd session fork (issue #3514)", () => {
  test("a fork opened in Flightdeck says the new session, and sends open flightdeck by default", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "fork", "c-111", "--cwd", "/work/app"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["forked c-111 as session s9"],
    });
    expect(callsOf(daemon, "session.fork")).toEqual([
      { claudeSessionId: "c-111", cwd: "/work/app", open: "flightdeck" },
    ]);
  });

  test("a fork for a terminal up to a message says the command that opens it, and rewinds nothing", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.fork": () => ({
        claudeSessionId: "c-new",
        command: "flightdeckd claude --resume c-new",
      }),
    });
    const run = await flightdeckd(
      ["session", "fork", "c-111", "--cwd", "/work/app", "--up-to", "m-9", "--open", "terminal"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["forked c-111 as c-new; open it with: flightdeckd claude --resume c-new"],
    });
    expect(callsOf(daemon, "session.fork")).toEqual([
      { claudeSessionId: "c-111", cwd: "/work/app", upToMessageId: "m-9", open: "terminal" },
    ]);
  });

  test("--json has the same keys for both ways of opening, null where the daemon gave none", async () => {
    const inApp = await flightdeckd(
      ["session", "fork", "c-111", "--cwd", "/work/app", "--json"],
      fakeDaemon(OPEN).port,
    );
    expect(jsonOf(inApp)).toEqual({
      action: "fork",
      claudeSessionId: "c-new",
      session: "s9",
      command: null,
    });
    const terminal = fakeDaemon({
      ...OPEN,
      "session.fork": () => ({
        claudeSessionId: "c-new",
        command: "flightdeckd claude --resume c-new",
      }),
    });
    const run = await flightdeckd(
      ["session", "fork", "c-111", "--cwd", "/work/app", "--open", "terminal", "--json"],
      terminal.port,
    );
    expect(jsonOf(run)).toEqual({
      action: "fork",
      claudeSessionId: "c-new",
      session: null,
      command: "flightdeckd claude --resume c-new",
    });
  });

  test("a session the runtime cannot fork is exit 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.fork": () => ({
        error: { code: "invalid_state", message: "an OpenCode session does not fork" },
      }),
    });
    const run = await flightdeckd(["session", "fork", "c-111", "--cwd", "/work/app"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("an OpenCode session does not fork");
  });

  test("no answer is exit 2, and it says a session may or may not have been started", async () => {
    const silent = fakeDaemon({ ...OPEN, "session.fork": () => undefined });
    const result = await runSessionCli(
      { action: "fork", claudeSessionId: "c-111", start: { cwd: "/work/app", open: "flightdeck" } },
      config(silent.port),
      { timeoutMs: 300 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("a session may or may not have been started");
  });
});

/** A verb that acts on one session, with what the daemon is asked and what it prints. */
const VERBS: Array<{
  argv: string[];
  type: string;
  payload: Record<string, unknown>;
  line: string;
  json: Record<string, unknown>;
  cli: SessionCliArgs;
}> = [
  {
    argv: ["set-mode", "fd-qa", "plan"],
    type: "session.setMode",
    payload: { sessionId: "s1", permissionMode: "plan" },
    line: "s1 runs in plan mode",
    json: { session: "s1", action: "set-mode", permissionMode: "plan" },
    cli: { action: "set-mode", session: "fd-qa", value: "plan" },
  },
  {
    argv: ["apply-persona", "fd-qa", "reviewer", "--language", "en"],
    type: "session.applyPersona",
    payload: { sessionId: "s1", persona: { id: "reviewer", language: "en" } },
    line: "s1 took the persona Reviewer (reviewer): the message went into the session",
    json: {
      session: "s1",
      action: "apply-persona",
      persona: REVIEWER,
      text: "You are Reviewer",
      delivery: "sent",
    },
    cli: {
      action: "apply-persona",
      session: "fd-qa",
      value: "reviewer",
      start: { language: "en" },
    },
  },
  {
    argv: ["clear-persona", "fd-qa", "--language", "en"],
    type: "session.clearPersona",
    payload: { sessionId: "s1", language: "en" },
    line: "s1 left the persona Reviewer: the message went into the session",
    json: {
      session: "s1",
      action: "clear-persona",
      persona: REVIEWER,
      text: "Back to normal",
      delivery: "sent",
    },
    cli: { action: "clear-persona", session: "fd-qa", start: { language: "en" } },
  },
];

describe("flightdeckd session verbs that set a mode or a persona (issue #3514)", () => {
  for (const verb of VERBS) {
    const title = verb.argv.join(" ");
    test(`session ${title} asks the daemon once, says what it did, exit 0`, async () => {
      const daemon = fakeDaemon(OPEN);
      const run = await flightdeckd(["session", ...verb.argv], daemon.port);
      expect({ code: run.code, out: run.out, err: run.err }).toEqual({
        code: 0,
        out: [verb.line],
        err: [],
      });
      expect(callsOf(daemon, verb.type)).toEqual([verb.payload]);
    });

    test(`session ${title} --json prints one value with stable keys`, async () => {
      const daemon = fakeDaemon(OPEN);
      const run = await flightdeckd(["session", ...verb.argv, "--json"], daemon.port);
      expect(run.code).toBe(0);
      expect(jsonOf(run)).toEqual(verb.json);
    });

    test(`session ${title} on a name two sessions share is refused with the ids and sends nothing`, async () => {
      const daemon = fakeDaemon(OPEN);
      const argv = ["session", ...verb.argv.map((word) => (word === "fd-qa" ? "twin" : word))];
      const run = await flightdeckd(argv, daemon.port);
      expect(run.code).toBe(1);
      expect(run.err.join("\n")).toContain("2 sessions are named twin: use an id (s2, s3)");
      expect(typesOf(daemon)).toEqual(["session.list"]);
    });

    test(`session ${title} with no answer exits 2 and says the change may or may not have gone in`, async () => {
      const silent = fakeDaemon({ ...OPEN, [verb.type]: () => undefined });
      const result = await runSessionCli(verb.cli, config(silent.port), { timeoutMs: 300 });
      expect(result.code).toBe(2);
      expect(result.err.join("\n")).toContain("may or may not");
    });
  }

  test("set-mode to bypassPermissions on a host that does not allow it is exit 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.setMode": () => ({
        error: { code: "bypassNotAllowed", message: "bypassPermissions is off on this host" },
      }),
    });
    const run = await flightdeckd(["session", "set-mode", "s1", "bypassPermissions"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("bypassPermissions is off on this host");
  });

  test("clear-persona on a session with no persona is exit 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.clearPersona": () => ({
        error: { code: "invalid_state", message: "no persona was applied to this session" },
      }),
    });
    const run = await flightdeckd(["session", "clear-persona", "s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("no persona was applied to this session");
    expect(callsOf(daemon, "session.clearPersona")).toEqual([{ sessionId: "s1" }]);
  });

  test("apply-persona of a persona the host does not have is exit 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.applyPersona": () => ({
        error: { code: "not_found", message: "no persona named ghost" },
      }),
    });
    const run = await flightdeckd(["session", "apply-persona", "s1", "ghost"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("no persona named ghost");
  });

  for (const [delivery, words] of [
    ["queued", "the message waits for the session's turn"],
    ["terminal", "the message went to the terminal session"],
  ] as const) {
    test(`a ${delivery} delivery says so`, async () => {
      const daemon = fakeDaemon({
        ...OPEN,
        "session.applyPersona": () => ({ persona: REVIEWER, text: "t", delivery }),
      });
      const run = await flightdeckd(["session", "apply-persona", "s1", "reviewer"], daemon.port);
      expect(run.out).toEqual([`s1 took the persona Reviewer (reviewer): ${words}`]);
    });
  }

  test("an older host that sends no delivery is still done, with nothing said about it", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.applyPersona": () => ({ persona: REVIEWER, text: "t" }),
    });
    const run = await flightdeckd(
      ["session", "apply-persona", "s1", "reviewer", "--json"],
      daemon.port,
    );
    expect(jsonOf(run)).toMatchObject({ delivery: null });
    const text = await flightdeckd(["session", "apply-persona", "s1", "reviewer"], daemon.port);
    expect(text.out).toEqual(["s1 took the persona Reviewer (reviewer)"]);
  });
});

describe("the arguments of session create, fork, set-mode and the persona verbs (issue #3514)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => JSON.stringify(parsed(argv));

  test("create and fork are read with their options, which stay off the other commands' fields", () => {
    const create = parsed(["session", "create", "--cwd", "/w", "--name", "n", "--persona", "p"]);
    expect(create).toMatchObject({
      command: "session",
      action: "create",
      sessionStart: { cwd: "/w", name: "n", persona: "p" },
    });
    expect(create).not.toHaveProperty("cwd");
    expect(create).not.toHaveProperty("personaName");
    expect(create).not.toHaveProperty("teamPersona");
    expect(
      parsed(["session", "fork", "c-1", "--cwd", "/w", "--up-to", "m", "--open", "terminal"]),
    ).toMatchObject({
      action: "fork",
      claudeSessionId: "c-1",
      sessionStart: { cwd: "/w", upToMessageId: "m", open: "terminal" },
    });
  });

  test("a prompt that starts with two dashes is taken with the = form", () => {
    expect(parsed(["session", "create", "--cwd", "/w", "--prompt=--fix the build"])).toMatchObject({
      sessionStart: { prompt: "--fix the build" },
    });
  });

  test("a missing folder, session, mode or persona is refused before anything is sent", () => {
    expect(refused(["session", "create"])).toContain("missing --cwd");
    expect(refused(["session", "fork", "c-1"])).toContain("missing --cwd");
    expect(refused(["session", "fork", "--cwd", "/w"])).toContain("missing the Claude session id");
    expect(refused(["session", "set-mode", "fd-qa"])).toContain("missing the mode");
    expect(refused(["session", "apply-persona", "fd-qa"])).toContain("missing the persona");
    expect(refused(["session", "clear-persona"])).toContain("missing the session");
  });

  test("a mode a live session cannot be switched to, or an unknown --open, is refused", () => {
    expect(refused(["session", "set-mode", "fd-qa", "auto"])).toContain("invalid mode: auto");
    expect(parsed(["session", "set-mode", "fd-qa", "bypassPermissions"])).toMatchObject({
      sessionValue: "bypassPermissions",
    });
    expect(refused(["session", "fork", "c-1", "--cwd", "/w", "--open", "nowhere"])).toContain(
      "--open: flightdeck or terminal",
    );
  });

  test("an option of another verb is refused and says which verbs take it", () => {
    expect(refused(["session", "close", "fd-qa", "--prompt", "x"])).toContain(
      "--prompt: this flag only applies to flightdeckd session create",
    );
    expect(refused(["session", "apply-persona", "fd-qa", "p", "--model", "opus"])).toContain(
      "--model: this flag only applies to flightdeckd session create",
    );
    expect(refused(["session", "create", "--cwd", "/w", "--up-to", "m"])).toContain(
      "--up-to: this flag only applies to flightdeckd session fork",
    );
    expect(refused(["session", "fork", "c-1", "--cwd", "/w", "--language", "en"])).toContain(
      "--language: this flag only applies to flightdeckd session create, apply-persona, clear-persona",
    );
  });

  test("--language on create needs --persona to mean anything", () => {
    expect(refused(["session", "create", "--cwd", "/w", "--language", "en"])).toContain(
      "--language: only with --persona",
    );
  });

  test("an option of session on any other command is refused, and the others keep their own flags", () => {
    expect(refused(["quota", "get", "--prompt", "x"])).toContain(
      "--prompt: this flag only applies to flightdeckd session create",
    );
    expect(refused(["card", "list", "--open", "terminal"])).toContain(
      "--open: this flag only applies to flightdeckd session fork",
    );
    expect(parsed(["history", "list", "--cwd", "/w"])).toMatchObject({
      command: "history",
      cwd: "/w",
    });
    expect(parsed(["persona", "show", "p", "--language", "en"])).toMatchObject({ language: "en" });
  });
});
