import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { terminalCliArgs } from "../../src/cli/domain/terminal-args.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const OPENED = {
  terminalId: "t7",
  cwd: "/home/pi/app",
  command: "bash",
  startedAt: "2026-11-20T09:00:00Z",
  attached: 0,
  cols: 80,
  rows: 24,
  exitCode: null,
  launchId: null,
};
const OPENED_LINE =
  "opened t7  bash  /home/pi/app  80x24  running  attached: 0  started: 2026-11-20T09:00:00Z";

const SESSIONS = {
  sessions: [
    { id: "s1", name: "fd-qa" },
    { id: "s2", name: "twin" },
    { id: "s3", name: "twin" },
  ],
};

const OPEN: Handlers = {
  "terminal.open": () => OPENED,
  "terminal.openSession": () => OPENED,
  "terminal.close": () => ({}),
  "terminal.settings": (payload) => ({
    enabled: (payload as { enabled: boolean }).enabled,
    max: 4,
    shell: "bash",
  }),
  "session.list": () => SESSIONS,
};

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd terminal open (issue #3538)", () => {
  test("a folder opens the host's shell at 80x24, and the line says which terminal it is", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "open", "--cwd", "/home/pi/app"], daemon.port);
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: [OPENED_LINE],
    });
    expect(sent(daemon, "terminal.open")).toEqual([{ cwd: "/home/pi/app", cols: 80, rows: 24 }]);
  });

  test("the words after -- the parser read reach the daemon as the program", async () => {
    const { runTerminalCli } = await import("../../src/terminal/index.ts");
    const daemon = fakeDaemon(OPEN);
    const args = parseArgs([
      "terminal",
      "open",
      "--cwd",
      "/srv",
      "--",
      "sh",
      "--login",
      "-c",
      "id",
    ]);
    const { code } = await runTerminalCli(terminalCliArgs(args), config(daemon.port));
    expect(code).toBe(0);
    expect(sent(daemon, "terminal.open")).toEqual([
      { cwd: "/srv", cols: 80, rows: 24, command: ["sh", "--login", "-c", "id"] },
    ]);
  });

  test("the program and its arguments go to the daemon as a list, never as one shell line", async () => {
    // `flightdeckd()` appends `--config` after the words, which a line with `--` would read as a program word.
    const { runTerminalCli } = await import("../../src/terminal/index.ts");
    const daemon = fakeDaemon(OPEN);
    const { code } = await runTerminalCli(
      { action: "open", cwd: "/srv", cols: 120, rows: 40, command: ["bash", "-lc", "ls -la"] },
      config(daemon.port),
    );
    expect(code).toBe(0);
    expect(sent(daemon, "terminal.open")).toEqual([
      { cwd: "/srv", cols: 120, rows: 40, command: ["bash", "-lc", "ls -la"] },
    ]);
  });

  test("--cols and --rows set the size", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["terminal", "open", "--cwd", "/srv", "--cols", "120", "--rows=40"],
      daemon.port,
    );
    expect(sent(daemon, "terminal.open")).toEqual([{ cwd: "/srv", cols: 120, rows: 40 }]);
  });

  test("--claude opens Claude Code here, with the session to resume and the persona when given", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["terminal", "open", "--cwd", "/srv", "--claude"], daemon.port);
    await flightdeckd(
      ["terminal", "open", "--cwd", "/srv", "--claude", "--resume", "abc-1", "--persona", "fd-qa"],
      daemon.port,
    );
    expect(sent(daemon, "terminal.open")).toEqual([
      { cwd: "/srv", cols: 80, rows: 24, claude: {} },
      { cwd: "/srv", cols: 80, rows: 24, claude: { resume: "abc-1", persona: "fd-qa" } },
    ]);
  });

  test("--json prints the terminal the daemon returns", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "open", "--cwd", "/srv", "--json"], daemon.port);
    expect(JSON.parse(run.out.join("\n"))).toEqual(OPENED);
  });

  test("a host with the terminal off refuses with its own words, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "terminal.open": () => ({
        error: { code: "terminal_disabled", message: "the terminal is off on this host" },
      }),
    });
    const run = await flightdeckd(["terminal", "open", "--cwd", "/srv"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the terminal is off on this host");
  });

  test("no answer exits 2 and says a terminal may or may not have opened", async () => {
    const { runTerminalCli } = await import("../../src/terminal/index.ts");
    const daemon = fakeDaemon({ "terminal.open": () => undefined });
    const result = await runTerminalCli(
      { action: "open", cwd: "/srv", cols: 80, rows: 24 },
      config(daemon.port),
      { timeoutMs: 300 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not");
  });
});

describe("flightdeckd terminal open-session (issue #3538)", () => {
  test("a session by name opens a shell in the folder the host holds for it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["terminal", "open-session", "--session", "fd-qa", "--cols", "100"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: [OPENED_LINE] });
    expect(sent(daemon, "terminal.openSession")).toEqual([{ session: "s1", cols: 100, rows: 24 }]);
  });

  test("a session that is not there, or that two share, opens nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const none = await flightdeckd(["terminal", "open-session", "--session", "nope"], daemon.port);
    const twin = await flightdeckd(["terminal", "open-session", "--session", "twin"], daemon.port);
    expect([none.code, twin.code]).toEqual([1, 1]);
    expect(none.err.join("\n")).toContain("no such session: nope");
    expect(twin.err.join("\n")).toContain("2 sessions are named twin");
    expect(sent(daemon, "terminal.openSession")).toEqual([]);
  });
});

describe("flightdeckd terminal close (issue #3538)", () => {
  test("--kill sends the kill and says only that, since the process may still be going", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "close", "t7", "--kill"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["kill sent to t7"] });
    expect(sent(daemon, "terminal.close")).toEqual([{ terminalId: "t7", kill: true }]);
  });

  test("without --kill a terminal that is still listed exits 1: this command never attached, so it detaches nothing", async () => {
    const { runTerminalCli } = await import("../../src/terminal/index.ts");
    const daemon = fakeDaemon({ ...OPEN, "terminal.list": () => ({ terminals: [OPENED] }) });
    const result = await runTerminalCli(
      { action: "close", terminalId: "t7", kill: false },
      config(daemon.port),
    );
    expect({ code: result.code, reason: result.reason }).toEqual({
      code: 1,
      reason: "terminal_still_running",
    });
    expect(result.err.join("\n")).toContain("--kill");
  });

  test("without --kill a terminal that is gone from the list was removed, and the line says so", async () => {
    const daemon = fakeDaemon({ ...OPEN, "terminal.list": () => ({ terminals: [] }) });
    const run = await flightdeckd(["terminal", "close", "t7"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["removed t7"] });
    expect(sent(daemon, "terminal.close")).toEqual([{ terminalId: "t7", kill: false }]);
  });

  test("--json says what was done", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "close", "t7", "--kill", "--json"], daemon.port);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ terminalId: "t7", kill: true, closed: true });
  });
});

describe("flightdeckd terminal settings (issue #3538)", () => {
  test("--disable turns the host's terminals off, and the line shows the settings", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "settings", "--disable"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["terminals off  max 4  shell bash"],
    });
    expect(sent(daemon, "terminal.settings")).toEqual([{ enabled: false }]);
  });

  test("--enable with --confirm turns them on", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["terminal", "settings", "--enable", "--confirm"], daemon.port);
    expect(run.out).toEqual(["terminals on  max 4  shell bash"]);
    expect(sent(daemon, "terminal.settings")).toEqual([{ enabled: true, confirm: true }]);
  });

  test("--enable without --confirm exits 1 as terminal_enable_confirm, and the daemon hears nothing", async () => {
    const { runTerminalCli } = await import("../../src/terminal/index.ts");
    const daemon = fakeDaemon(OPEN);
    const result = await runTerminalCli({ action: "settings", enabled: true }, config(daemon.port));
    expect({ code: result.code, reason: result.reason }).toEqual({
      code: 1,
      reason: "terminal_enable_confirm",
    });
    expect(result.err.join("\n")).toContain("a full shell");
    expect(sent(daemon, "terminal.settings")).toEqual([]);
    const run = await flightdeckd(["terminal", "settings", "--enable"], daemon.port);
    expect(run.code).toBe(1);
    expect(sent(daemon, "terminal.settings")).toEqual([]);
  });
});

describe("the arguments of the terminal write verbs (issue #3538)", () => {
  const refused = (argv: string[]) => {
    try {
      parseArgs(argv);
      return "parsed";
    } catch (error) {
      return (error as Error).message.split("\n")[0];
    }
  };

  test("open reads its folder, size, program and Claude options", () => {
    expect(
      parseArgs(["terminal", "open", "--cwd", "/srv", "--cols", "90", "--", "sh", "--login"]),
    ).toMatchObject({
      command: "terminal",
      action: "open",
      terminalCwd: "/srv",
      terminalCols: 90,
      terminalArgv: ["sh", "--login"],
    });
    expect(
      parseArgs([
        "terminal",
        "open",
        "--cwd",
        "/srv",
        "--claude",
        "--resume",
        "r1",
        "--persona",
        "p",
      ]),
    ).toMatchObject({
      action: "open",
      terminalClaude: true,
      terminalResume: "r1",
      terminalPersona: "p",
    });
  });

  test("a value on the -- separator is refused, so --=x is never read as the program's start", () => {
    expect(refused(["terminal", "open", "--cwd", "/srv", "--=x", "sh"])).toContain("--");
  });

  test("open needs a folder, and --claude and a program after -- do not go together", () => {
    expect(refused(["terminal", "open"])).toBe("missing --cwd");
    expect(refused(["terminal", "open", "--cwd", "/srv", "--claude", "--", "bash"])).toBe(
      "--claude and a program after -- cannot go together",
    );
  });

  test("--resume and --persona belong to --claude", () => {
    expect(refused(["terminal", "open", "--cwd", "/srv", "--resume", "r1"])).toBe(
      "--resume: only with --claude",
    );
    expect(refused(["terminal", "open", "--cwd", "/srv", "--persona", "p"])).toBe(
      "--persona: only with --claude",
    );
  });

  test("the size is a whole number inside what the protocol takes", () => {
    for (const [flag, bad] of [
      ["--cols", "0"],
      ["--cols", "501"],
      ["--cols", "abc"],
      ["--rows", "0"],
      ["--rows", "301"],
      ["--rows", "2e1"],
    ] as const) {
      expect(refused(["terminal", "open", "--cwd", "/srv", flag, bad])).toStartWith(
        `${flag}: a whole number from 1 to `,
      );
    }
  });

  test("open-session needs a session and takes no folder; close needs a terminal id", () => {
    expect(refused(["terminal", "open-session"])).toBe("missing --session");
    expect(refused(["terminal", "open-session", "--session", "s", "--cwd", "/x"])).toBe(
      "--cwd: this flag only applies to flightdeckd terminal open",
    );
    expect(refused(["terminal", "close"])).toBe("missing the terminal id");
    expect(parseArgs(["terminal", "close", "t7", "--kill"])).toMatchObject({
      action: "close",
      terminalId: "t7",
      terminalKill: true,
    });
  });

  test("settings takes --enable or --disable, one of them", () => {
    expect(refused(["terminal", "settings"])).toBe("terminal settings needs --enable or --disable");
    expect(refused(["terminal", "settings", "--enable", "--disable"])).toBe(
      "--enable or --disable, not both",
    );
    expect(refused(["terminal", "settings", "--disable", "--confirm"])).toBe(
      "--confirm: only with terminal settings --enable",
    );
  });

  test("a flag of one verb is refused on the others, and attach, write and resize are no words", () => {
    expect(refused(["terminal", "list", "--kill"])).toBe(
      "--kill: this flag only applies to flightdeckd terminal close",
    );
    expect(refused(["terminal", "open", "--cwd", "/srv", "--enable"])).toBe(
      "--enable: this flag only applies to flightdeckd terminal settings",
    );
    for (const verb of ["attach", "write", "resize", "ack", "detach"]) {
      expect(refused(["terminal", verb])).toBe(`invalid terminal action: ${verb}`);
    }
  });
});
