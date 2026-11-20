import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const RUNNING = {
  terminalId: "t1",
  cwd: "/home/pi/app",
  command: "bash",
  startedAt: "2026-11-20T09:00:00Z",
  attached: 1,
  cols: 80,
  rows: 24,
  exitCode: null,
  launchId: null,
};
const EXITED = {
  ...RUNNING,
  terminalId: "t2",
  cwd: "/srv/api",
  command: "claude",
  attached: 0,
  cols: 120,
  rows: 40,
  exitCode: 130,
  launchId: "L-9",
};

const OPEN: Handlers = {
  "terminal.list": () => ({ terminals: [RUNNING, EXITED] }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd terminal list (issue #3538)", () => {
  test("a terminal is one line: its id, program, folder, size, state, followers and start", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "list"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "t1  bash  /home/pi/app  80x24  running  attached: 1  started: 2026-11-20T09:00:00Z",
      "t2  claude  /srv/api  120x40  exited 130  attached: 0  started: 2026-11-20T09:00:00Z  launch: L-9",
    ]);
    expect(callsOf(daemon, "terminal.list")).toEqual([{}]);
  });

  test("--json prints the terminals as the protocol returns them, with null for a missing field", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ terminals: [RUNNING, EXITED] });
  });

  test("with none it says so, and --json prints an empty list", async () => {
    const daemon = fakeDaemon({ "terminal.list": () => ({ terminals: [] }) });
    const text = await flightdeckd(["terminal", "list"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["no terminal"] });
    const asJson = await flightdeckd(["terminal", "list", "--json"], daemon.port);
    expect(JSON.parse(asJson.out.join("\n"))).toEqual({ terminals: [] });
  });

  test("a folder that carries terminal controls is printed without them, in the text and in --json", async () => {
    const hostile = { ...RUNNING, cwd: "/tmp/ok\u001b[2Jgone‮x" };
    const daemon = fakeDaemon({ "terminal.list": () => ({ terminals: [hostile] }) });
    const text = await flightdeckd(["terminal", "list"], daemon.port);
    expect(text.out.join("\n")).toContain("/tmp/ok [2Jgone x  80x24");
    const asJson = await flightdeckd(["terminal", "list", "--json"], daemon.port);
    expect(asJson.out.join("\n")).not.toContain("\u202e");
  });

  test("the daemon's refusal is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      "terminal.list": () => ({
        error: { code: "terminal_disabled", message: "the terminal is off on this host" },
      }),
    });
    const run = await flightdeckd(["terminal", "list"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the terminal is off on this host");
  });

  test("a read with no answer exits 2 and never says it may have changed something", async () => {
    const { runTerminalCli } = await import("../../src/terminal/index.ts");
    const daemon = fakeDaemon({ "terminal.list": () => undefined });
    const result = await runTerminalCli({ action: "list" }, config(daemon.port), {
      timeoutMs: 300,
    });
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).not.toContain("may or may not");
  });
});

describe("flightdeckd terminal, as the terminal runs it (issue #3538)", () => {
  test("a daemon that closes before it answers exits 2", async () => {
    const daemon = fakeDaemon({ "terminal.list": () => CLOSE });
    const run = await flightdeckd(["terminal", "list"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("no daemon at the address of the config: exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["terminal", "list"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });
});

describe("the arguments of terminal (issue #3538)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("list is read with --json and --host", () => {
    expect(parsed(["terminal", "list", "--json"])).toMatchObject({
      command: "terminal",
      action: "list",
      json: true,
    });
    expect(parsed(["terminal", "list", "--host", "pi"])).toMatchObject({
      command: "terminal",
      action: "list",
      host: "pi",
    });
  });

  test("a missing verb, an unknown one or an app-only one is refused before anything is sent", () => {
    for (const argv of [
      ["terminal"],
      ["terminal", "bogus"],
      ["terminal", "attach"],
      ["terminal", "write"],
    ])
      expect(JSON.stringify(parsed(argv))).toContain("invalid terminal action");
  });

  test("list reads no target, so a typo cannot pass", () => {
    expect(JSON.stringify(parsed(["terminal", "list", "t1"]))).toContain("unknown argument: t1");
  });
});
