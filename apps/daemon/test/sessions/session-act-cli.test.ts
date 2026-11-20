import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runSessionCli } from "../../src/sessions/index.ts";
import { config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
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

const OPEN: Handlers = {
  "session.list": () => SESSIONS,
  "session.interrupt": () => ({}),
  "session.close": () => ({}),
  "session.resume": () => ({}),
  "session.sleep": () => ({ result: "slept" }),
  "session.setModel": () => ({}),
  "session.setEffort": () => ({}),
  "session.meta.set": (payload) => ({
    claudeSessionId: "c-111",
    name: null,
    pinned: false,
    archived: false,
    ...(payload as object),
  }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const writesOf = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type !== "session.list" && c.type !== "hello");

/** One verb of one session: what it types, what it asks the daemon, what it says and what --json prints. */
const VERBS: Array<{
  argv: string[];
  type: string;
  payload: Record<string, unknown>;
  line: string;
  json: Record<string, unknown>;
}> = [
  {
    argv: ["interrupt", "fd-qa"],
    type: "session.interrupt",
    payload: { sessionId: "s1" },
    line: "s1 interrupted",
    json: { session: "s1", action: "interrupt" },
  },
  {
    argv: ["close", "fd-qa"],
    type: "session.close",
    payload: { sessionId: "s1" },
    line: "s1 closed",
    json: { session: "s1", action: "close" },
  },
  {
    argv: ["resume", "fd-qa"],
    type: "session.resume",
    payload: { sessionId: "s1" },
    line: "s1 resumed",
    json: { session: "s1", action: "resume" },
  },
  {
    argv: ["sleep", "fd-qa"],
    type: "session.sleep",
    payload: { sessionId: "s1" },
    line: "s1 is asleep",
    json: { session: "s1", action: "sleep", result: "slept" },
  },
  {
    argv: ["set-model", "fd-qa", "opus"],
    type: "session.setModel",
    payload: { sessionId: "s1", model: "opus" },
    line: "s1 uses the model opus",
    json: { session: "s1", action: "set-model", model: "opus" },
  },
  {
    argv: ["set-model", "fd-qa", "default"],
    type: "session.setModel",
    payload: { sessionId: "s1", model: null },
    line: "s1 uses the default model",
    json: { session: "s1", action: "set-model", model: null },
  },
  {
    argv: ["set-effort", "fd-qa", "high"],
    type: "session.setEffort",
    payload: { sessionId: "s1", effort: "high" },
    line: "s1 works at the effort high",
    json: { session: "s1", action: "set-effort", effort: "high" },
  },
  {
    argv: ["set-effort", "fd-qa", "default"],
    type: "session.setEffort",
    payload: { sessionId: "s1", effort: null },
    line: "s1 works at the default effort",
    json: { session: "s1", action: "set-effort", effort: null },
  },
  {
    argv: ["meta", "set", "fd-qa", "name=Review", "pinned=true"],
    type: "session.meta.set",
    payload: { claudeSessionId: "c-111", name: "Review", pinned: true },
    line: "s1 updated: name Review, pinned true",
    json: {
      session: "s1",
      action: "meta-set",
      claudeSessionId: "c-111",
      name: "Review",
      pinned: true,
      archived: false,
    },
  },
];

describe("flightdeckd session verbs that act (issue #3514)", () => {
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
      expect(JSON.parse(run.out.join("\n"))).toEqual(verb.json);
    });

    test(`session ${title} on a name two sessions share is refused with the ids and sends nothing`, async () => {
      const daemon = fakeDaemon(OPEN);
      const argv = ["session", ...verb.argv.map((word) => (word === "fd-qa" ? "twin" : word))];
      const run = await flightdeckd(argv, daemon.port);
      expect(run.code).toBe(1);
      expect(run.err.join("\n")).toContain("2 sessions are named twin: use an id (s2, s3)");
      expect(writesOf(daemon)).toEqual([]);
    });

    test(`session ${title} with no answer exits 2 and says the change may or may not have gone in`, async () => {
      const silent = fakeDaemon({ ...OPEN, [verb.type]: () => undefined });
      expect(() => parseArgs(["session", ...verb.argv])).not.toThrow();
      const typed = parseArgs(["session", ...verb.argv]);
      const result = await runSessionCli(
        {
          action: typed.action as "close",
          session: typed.sessionRef,
          ...(typed.sessionValue === undefined ? {} : { value: typed.sessionValue }),
          ...(typed.sessionMeta === undefined ? {} : { meta: typed.sessionMeta }),
        },
        config(silent.port),
        { timeoutMs: 300 },
      );
      expect(result.code).toBe(2);
      expect(result.err.join("\n")).toContain("may or may not");
    });
  }
});

describe("flightdeckd session sleep, by what the daemon answers (issue #3514)", () => {
  const sleeping = (result: string): Handlers => ({
    ...OPEN,
    "session.sleep": () => ({ result }),
  });

  test("a session that was already asleep is done, exit 0", async () => {
    const daemon = fakeDaemon(sleeping("already"));
    const run = await flightdeckd(["session", "sleep", "s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["s1 was already asleep"] });
  });

  for (const [result, reason] of [
    ["not_idle", "it is not idle"],
    ["queued", "a message waits for it"],
    ["kept_awake", "something keeps it awake"],
    ["subscribed", "someone is watching it"],
  ] as const) {
    test(`a ${result} answer is refused with its reason, exit 1, and nothing on stdout`, async () => {
      const daemon = fakeDaemon(sleeping(result));
      const run = await flightdeckd(["session", "sleep", "s1"], daemon.port);
      expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
      expect(run.err.join("\n")).toContain(`s1 was not put to sleep: ${reason}`);
    });
  }

  test("an answer this CLI does not know is not taken for a sleep: exit 1, and it says what came", async () => {
    const daemon = fakeDaemon(sleeping("busy_card"));
    const run = await flightdeckd(["session", "sleep", "s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("s1 was not put to sleep: the daemon answered busy_card");
  });

  test("--json of a refused sleep prints nothing on stdout and the reason on stderr", async () => {
    const daemon = fakeDaemon(sleeping("not_idle"));
    const run = await flightdeckd(["session", "sleep", "s1", "--json"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("s1 was not put to sleep: it is not idle");
  });
});

describe("flightdeckd session, what the daemon refuses (issue #3514)", () => {
  test("resume of a session that has not ended is exit 1 with the daemon's own text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.resume": () => ({
        error: { code: "sessionNotEnded", message: "s1 has not ended: it cannot be resumed" },
      }),
    });
    const run = await flightdeckd(["session", "resume", "s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("s1 has not ended: it cannot be resumed");
  });

  test("meta set of a session that is not controllable is exit 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.meta.set": () => ({
        error: { code: "not_controllable", message: "only sessions opened by flightdeckd claude" },
      }),
    });
    const run = await flightdeckd(["session", "meta", "set", "s1", "pinned=true"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("only sessions opened by flightdeckd claude");
  });

  test("meta set of a session with no Claude session id yet is refused and nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "meta", "set", "s4", "pinned=true"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("s4 has no Claude session yet");
    expect(callsOf(daemon, "session.meta.set")).toEqual([]);
  });

  test("a session that does not exist is refused and nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "close", "nobody"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("no such session: nobody");
    expect(writesOf(daemon)).toEqual([]);
  });

  test("meta set says what the daemon kept, not what was asked", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.meta.set": () => ({
        claudeSessionId: "c-111",
        name: "Kept",
        pinned: true,
        archived: false,
      }),
    });
    const run = await flightdeckd(["session", "meta", "set", "s1", "name=Asked"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["s1 updated: name Kept"],
    });
  });

  test("meta set with an empty name clears it, and says so", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["session", "meta", "set", "s1", "name="], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["s1 updated: name cleared"],
    });
    expect(callsOf(daemon, "session.meta.set")).toEqual([{ claudeSessionId: "c-111", name: null }]);
  });
});

describe("the arguments of the session verbs that act (issue #3514)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => JSON.stringify(parsed(argv));

  test("each verb is read with its session, its value, --json and --host", () => {
    expect(parsed(["session", "close", "fd-qa", "--json", "--host", "pi"])).toMatchObject({
      command: "session",
      action: "close",
      sessionRef: "fd-qa",
      json: true,
      host: "pi",
    });
    expect(parsed(["session", "set-model", "fd-qa", "opus"])).toMatchObject({
      action: "set-model",
      sessionRef: "fd-qa",
      sessionValue: "opus",
    });
    expect(parsed(["session", "meta", "set", "fd-qa", "name=A b", "archived=false"])).toMatchObject(
      { action: "meta-set", sessionRef: "fd-qa", sessionMeta: { name: "A b", archived: false } },
    );
  });

  test("a missing session or value is refused before anything is sent", () => {
    expect(refused(["session", "close"])).toContain("missing the session");
    expect(refused(["session", "set-model", "fd-qa"])).toContain("missing the model");
    expect(refused(["session", "set-effort", "fd-qa"])).toContain("missing the effort");
    expect(refused(["session", "meta", "set", "fd-qa"])).toContain("missing a field to set");
  });

  test("an effort that is not one of the levels is refused, and default is accepted", () => {
    expect(refused(["session", "set-effort", "fd-qa", "huge"])).toContain("invalid effort: huge");
    expect(parsed(["session", "set-effort", "fd-qa", "xhigh"])).toMatchObject({
      sessionValue: "xhigh",
    });
  });

  test("a meta field that is unknown, or a flag value that is not true or false, is refused", () => {
    expect(refused(["session", "meta", "set", "fd-qa", "color=red"])).toContain(
      "invalid session field: color",
    );
    expect(refused(["session", "meta", "set", "fd-qa", "pinned=yes"])).toContain(
      "pinned must be true or false",
    );
    expect(refused(["session", "meta", "set", "fd-qa", "pinned"])).toContain(
      "invalid session field: pinned",
    );
  });

  test("meta needs set, and a word the verb does not read is refused", () => {
    expect(refused(["session", "meta", "get", "fd-qa"])).toContain("invalid session meta action");
    expect(refused(["session", "close", "fd-qa", "extra"])).toContain("unknown argument: extra");
  });
});
