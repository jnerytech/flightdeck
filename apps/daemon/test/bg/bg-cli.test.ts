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
    expect(/[\u001b\u0007]/.test(run.out.join("\n"))).toBe(false);
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
