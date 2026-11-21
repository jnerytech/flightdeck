import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SESSION = {
  id: "ab12",
  name: "fix the parser",
  cwd: "/work/api",
  state: "working",
  status: "busy",
  waitingFor: null,
  pid: 4242,
  claudeSessionId: "c-1",
  startedAt: 1_795_000_000_000,
  costUsd: 0.42,
};

const WAITING = {
  id: "cd34",
  name: null,
  cwd: "/work/web",
  state: "blocked",
  status: "waiting",
  waitingFor: "permission prompt",
  pid: 77,
  claudeSessionId: null,
  startedAt: null,
  costUsd: null,
};

const LIST = { supported: true, sessions: [SESSION, WAITING] };
const OPEN: Handlers = { "bg.list": () => LIST };

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

describe("flightdeckd bg list (issue #3734)", () => {
  test("one line a session: its id, state, what it waits for, its name or folder and its cost", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["bg", "list"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "2 background sessions",
        "  ab12 working (busy) fix the parser $0.42",
        "  cd34 blocked (waiting), waiting for permission prompt /work/web",
      ],
      err: [],
    });
    expect(daemon.calls.filter((c) => c.type === "bg.list").map((c) => c.payload)).toEqual([{}]);
  });

  test("--json keeps every key of a session, with null where the daemon has none", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["bg", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({ supported: true, sessions: [SESSION, WAITING] });
  });

  test("a host with none says so, and --json is an empty list", async () => {
    const daemon = fakeDaemon({ "bg.list": () => ({ supported: true, sessions: [] }) });
    const text = await flightdeckd(["bg", "list"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["no background sessions"],
    });
    const asJson = await flightdeckd(["bg", "list", "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual({ supported: true, sessions: [] });
  });

  test("a host whose claude has no background sessions says so and exits 0, with an empty list", async () => {
    const daemon = fakeDaemon({ "bg.list": () => ({ supported: false, sessions: [] }) });
    const text = await flightdeckd(["bg", "list"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["this host's claude has no background sessions"],
    });
    const asJson = await flightdeckd(["bg", "list", "--json"], daemon.port);
    expect({ code: asJson.code, printed: printed(asJson.out) }).toEqual({
      code: 0,
      printed: { supported: false, sessions: [] },
    });
  });

  test("a name from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "bg.list": () => ({
        supported: true,
        sessions: [{ ...SESSION, name: "a\u001b[2Jwiped", waitingFor: "x\u0007y" }],
      }),
    });
    const run = await flightdeckd(["bg", "list"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(["\u001b", "\u0007"].some((c) => run.out.join("\n").includes(c))).toBe(false);
  });

  test("a refusal is one line on stderr and exit 1; a closed connection is exit 2", async () => {
    const refusing = fakeDaemon({
      "bg.list": () => ({ error: { code: "feature_off", message: "background is off" } }),
    });
    const gone = fakeDaemon({ "bg.list": () => CLOSE });
    const refused = await flightdeckd(["bg", "list"], refusing.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("background is off");
    expect((await flightdeckd(["bg", "list"], gone.port)).code).toBe(2);
  });
});

describe("flightdeckd bg words (issue #3734)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`bg list` takes --json and --host", () => {
    expect(argsOf(["bg", "list", "--json", "--host", "pi"])).toMatchObject({
      command: "bg",
      action: "list",
      json: true,
      host: "pi",
    });
  });

  test("a missing verb, an unknown verb and a word after list are refused", () => {
    expect(JSON.stringify(argsOf(["bg"]))).toContain("invalid bg action");
    expect(JSON.stringify(argsOf(["bg", "attach", "ab12"]))).toContain("invalid bg action");
    expect(JSON.stringify(argsOf(["bg", "list", "ab12"]))).toContain("unknown argument");
  });
});

const WRITES: Handlers = {
  "bg.start": () => ({ id: "ef56" }),
  "bg.stop": () => LIST,
  "bg.respawn": () => LIST,
  "bg.message": () => LIST,
};

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd bg start, stop, respawn and message (issue #3734)", () => {
  test("start with a folder and a prompt sends them with the name and the persona, and prints the new id", async () => {
    const daemon = fakeDaemon(WRITES);
    const run = await flightdeckd(
      [
        "bg",
        "start",
        "--cwd",
        "/work/api",
        "--prompt",
        "fix the parser",
        "--name",
        "parser",
        "--persona",
        "fd-dev",
      ],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["started background session ef56"],
      err: [],
    });
    expect(sent(daemon, "bg.start")).toEqual([
      { cwd: "/work/api", prompt: "fix the parser", name: "parser", persona: "fd-dev" },
    ]);
  });

  test("start from a card sends the card id alone, and --json prints the id", async () => {
    const daemon = fakeDaemon(WRITES);
    const run = await flightdeckd(["bg", "start", "--card", "c1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({ id: "ef56" });
    expect(sent(daemon, "bg.start")).toEqual([{ cardId: "c1" }]);
  });

  test("stop, respawn and message send the id (and the text) and say what they did", async () => {
    const daemon = fakeDaemon(WRITES);
    const stop = await flightdeckd(["bg", "stop", "ab12"], daemon.port);
    const respawn = await flightdeckd(["bg", "respawn", "ab12"], daemon.port);
    const message = await flightdeckd(["bg", "message", "ab12", "--text", "go on"], daemon.port);
    expect([stop.out, respawn.out, message.out]).toEqual([
      ["stopped ab12"],
      ["respawned ab12"],
      ["sent a message to ab12"],
    ]);
    expect(sent(daemon, "bg.stop")).toEqual([{ id: "ab12" }]);
    expect(sent(daemon, "bg.respawn")).toEqual([{ id: "ab12" }]);
    expect(sent(daemon, "bg.message")).toEqual([{ id: "ab12", text: "go on" }]);
  });

  test("--json of stop prints the sessions the daemon answers with", async () => {
    const daemon = fakeDaemon(WRITES);
    const run = await flightdeckd(["bg", "stop", "ab12", "--json"], daemon.port);
    expect(printed(run.out)).toEqual(LIST);
  });

  test("a daemon refusal is exit 1 with its message; a daemon that dies is exit 2 and says to look before trying again", async () => {
    const refusing = fakeDaemon({
      ...WRITES,
      "bg.message": () => ({
        error: { code: "bg_no_message_path", message: "no way to message it" },
      }),
    });
    const refused = await flightdeckd(["bg", "message", "ab12", "--text", "x"], refusing.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("no way to message it");

    const dying = fakeDaemon({ ...WRITES, "bg.start": () => CLOSE });
    const lost = await flightdeckd(["bg", "start", "--card", "c1"], dying.port);
    expect(lost.code).toBe(2);
    expect(lost.err.join("\n")).toContain("bg list");
  });

  test("what the schema would refuse is refused before the daemon is asked", async () => {
    const daemon = fakeDaemon(WRITES);
    const refusals = [
      ["bg", "start"],
      ["bg", "start", "--cwd", "/w"],
      ["bg", "start", "--prompt", "x"],
      ["bg", "start", "--card", "c1", "--cwd", "/w", "--prompt", "x"],
      ["bg", "start", "--card", "c1", "--persona", "Bad Persona"],
      ["bg", "start", "--card", "c1", "--name", "n".repeat(121)],
      ["bg", "stop", "bad id"],
      ["bg", "stop"],
      ["bg", "message", "ab12"],
      ["bg", "message", "ab12", "--text", ""],
      ["bg", "message", "ab12", "--text", "x".repeat(32_001)],
    ];
    const codes = [];
    for (const argv of refusals) codes.push((await flightdeckd(argv, daemon.port)).code);
    expect(codes).toEqual(refusals.map(() => 1));
    expect(daemon.calls.filter((c) => c.type.startsWith("bg."))).toEqual([]);
  });
});

describe("flightdeckd bg write words (issue #3734)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("each verb reads its operand and flags", () => {
    expect(
      argsOf(["bg", "start", "--cwd", "/w", "--prompt", "p", "--name", "n", "--persona", "fd-dev"]),
    ).toMatchObject({ command: "bg", action: "start" });
    expect(argsOf(["bg", "start", "--card", "c1"])).toMatchObject({
      command: "bg",
      action: "start",
    });
    expect(argsOf(["bg", "stop", "ab12"])).toMatchObject({ command: "bg", action: "stop" });
    expect(argsOf(["bg", "respawn", "ab12"])).toMatchObject({ command: "bg", action: "respawn" });
    expect(argsOf(["bg", "message", "ab12", "--text", "hi"])).toMatchObject({
      command: "bg",
      action: "message",
    });
  });

  test("a flag a verb does not take is refused, and --card belongs to bg start only", () => {
    const refused = (argv: string[]) => "refusedWith" in argsOf(argv);
    expect(
      [
        ["bg", "stop", "ab12", "--text", "x"],
        ["bg", "stop", "ab12", "--cwd", "/w"],
        ["bg", "respawn", "ab12", "--prompt", "x"],
        ["bg", "message", "ab12", "--text", "x", "--name", "n"],
        ["bg", "message", "ab12", "--text", "x", "--card", "c1"],
        ["bg", "list", "--card", "c1"],
        ["card", "get", "c1", "--card", "c1"],
      ].map(refused),
    ).toEqual([true, true, true, true, true, true, true]);
  });

  test("the flags other commands own still read as before", () => {
    expect(argsOf(["history", "list", "--cwd", "/w"])).toMatchObject({
      command: "history",
      cwd: "/w",
    });
    expect("refusedWith" in argsOf(["history", "list", "--text", "x"])).toBe(true);
  });
});
