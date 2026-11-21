import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runBoardsyncCli } from "../../src/boardsync/index.ts";
import { parseArgs } from "../../src/main.ts";
import {
  CLOSE,
  fakeDaemon,
  type Handlers,
  project,
  stopAll,
  TOKEN,
} from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const LINKED = {
  linked: true,
  provider: "github",
  boardId: "PVT_1",
  boardTitle: "Roadmap",
  columnMap: { Todo: "backlog", Doing: "in_progress" },
  push: false,
  lastSyncedAt: "2026-11-20T09:00:00Z",
  lastError: null,
  pausedUntil: null,
  truncated: false,
  statusOptions: ["Todo", "Doing", "Done"],
};

const STATUS_LINES = [
  "api: linked to Roadmap (github, PVT_1)",
  "  push: off",
  "  last sync: 2026-11-20T09:00:00Z",
  "  map: Todo -> backlog, Doing -> in_progress",
  "  statuses: Todo, Doing, Done",
];

const REPORT = {
  created: 0,
  moved: 0,
  updated: 0,
  conflicts: 0,
  unmapped: 0,
  gone: 0,
  skipped: 0,
  pushed: 0,
  redacted: 0,
  truncated: false,
  notModified: false,
};

/** What the real service answers when it refuses: the code is the `reason`, the text is the person's. */
const refusal = (reason: string, message: string, code = "invalid_state") => ({
  error: { code, message, reason },
});

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "boardsync.link": () => LINKED,
  "boardsync.unlink": () => undefined,
  "boardsync.setMap": () => LINKED,
  "boardsync.setPush": () => ({ ...LINKED, push: true }),
  "boardsync.syncNow": () => ({ status: LINKED, report: REPORT }),
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

const config = (port: number) => ({ bind: "127.0.0.1", port, token: TOKEN });

describe("flightdeckd boardsync link (issue #3540)", () => {
  test("a project by name and a board id link them, asking for the board's own map, and print where the sync stands", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "link", "api", "PVT_1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: STATUS_LINES,
      err: [],
    });
    expect(callsOf(daemon, "boardsync.link")).toEqual([{ projectId: "p1", boardId: "PVT_1" }]);
  });

  test("each --map is one status of the board and the column it goes to, split on the last =", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "boardsync",
        "link",
        "api",
        "PVT_1",
        "--map",
        "No status=backlog",
        "--map",
        "Em revisão ✅=review",
        "--map",
        "a=b=done",
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "boardsync.link")).toEqual([
      {
        projectId: "p1",
        boardId: "PVT_1",
        columnMap: { "No status": "backlog", "Em revisão ✅": "review", "a=b": "done" },
      },
    ]);
  });

  test("--json prints the status the protocol returns, with null for what it leaves out", async () => {
    const daemon = fakeDaemon({ ...OPEN, "boardsync.link": () => ({ linked: true }) });
    const run = await flightdeckd(["boardsync", "link", "api", "PVT_1", "--json"], daemon.port);
    expect({ code: run.code, value: printed(run.out) }).toEqual({
      code: 0,
      value: {
        linked: true,
        provider: null,
        boardId: null,
        boardTitle: null,
        columnMap: null,
        push: null,
        lastSyncedAt: null,
        lastError: null,
        pausedUntil: null,
        truncated: null,
        statusOptions: null,
      },
    });
  });

  test("each refusal of the daemon is its text on stderr and exit 1", async () => {
    const refusals: Array<[string, ReturnType<typeof refusal>]> = [
      [
        "the project already has a linked board",
        refusal("board_sync_already_linked", "the project already has a linked board"),
      ],
      [
        "the board has no Status field",
        refusal("board_sync_field_not_found", "the board has no Status field"),
      ],
      ["gh is not signed in", refusal("gh_logged_out", "gh is not signed in", "unavailable")],
    ];
    const got: Array<{ code: number | null; out: string[]; err: boolean }> = [];
    for (const [text, answer] of refusals) {
      const daemon = fakeDaemon({ ...OPEN, "boardsync.link": () => answer });
      const run = await flightdeckd(["boardsync", "link", "api", "PVT_1"], daemon.port);
      got.push({ code: run.code, out: run.out, err: run.err.join("\n").includes(text) });
    }
    expect(got).toEqual(refusals.map(() => ({ code: 1, out: [], err: true })));
  });

  test("a project name two projects share is refused with nothing sent to the board", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "link", "web", "PVT_1"], daemon.port);
    expect({
      code: run.code,
      said: run.err.join("\n").includes("is the name of several projects"),
    }).toEqual({
      code: 1,
      said: true,
    });
    expect(callsOf(daemon, "boardsync.link")).toEqual([]);
  });

  test("a daemon that goes silent after a link says it may or may not have happened and exits 2", async () => {
    const silent = fakeDaemon({ "project.list": OPEN["project.list"] as never });
    const result = await runBoardsyncCli(
      { action: "link", target: "api", boardId: "PVT_1" },
      config(silent.port),
      { timeoutMs: 300 },
    );
    expect({
      code: result.code,
      said: result.err.join("\n").includes("may or may not"),
    }).toEqual({ code: 2, said: true });
  });

  test("a daemon that closes the connection mid-link is exit 2 and says the same", async () => {
    const daemon = fakeDaemon({ ...OPEN, "boardsync.link": () => CLOSE });
    const run = await flightdeckd(["boardsync", "link", "api", "PVT_1"], daemon.port);
    expect({ code: run.code, said: run.err.join("\n").includes("may or may not") }).toEqual({
      code: 2,
      said: true,
    });
  });
});

describe("flightdeckd boardsync unlink (issue #3540)", () => {
  test("a project by name is unlinked and the line says so", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "unlink", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["api: unlinked from its board"],
      err: [],
    });
    expect(callsOf(daemon, "boardsync.unlink")).toEqual([{ projectId: "p1" }]);
  });

  test("--json says which project was unlinked", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "unlink", "api", "--json"], daemon.port);
    expect({ code: run.code, value: printed(run.out) }).toEqual({
      code: 0,
      value: { unlinked: true, projectId: "p1" },
    });
  });

  test("a project with no board is the daemon's text and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.unlink": () => refusal("board_sync_not_linked", "the project has no linked board"),
    });
    const run = await flightdeckd(["boardsync", "unlink", "api"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the project has no linked board");
  });
});

describe("flightdeckd boardsync set-map (issue #3540)", () => {
  test("the --map pairs are sent as the project's new map and the status is printed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["boardsync", "set-map", "api", "--map", "Todo=backlog", "--map", "Doing=in_progress"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: STATUS_LINES });
    expect(callsOf(daemon, "boardsync.setMap")).toEqual([
      { projectId: "p1", columnMap: { Todo: "backlog", Doing: "in_progress" } },
    ]);
  });

  test("a status the board does not have is the daemon's text and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.setMap": () => refusal("board_sync_bad_map", "the board has no status Nope"),
    });
    const run = await flightdeckd(
      ["boardsync", "set-map", "api", "--map", "Nope=backlog"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the board has no status Nope");
  });
});

describe("flightdeckd boardsync set-push (issue #3540)", () => {
  test("--on --confirm turns it on and sends the confirmation the person typed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["boardsync", "set-push", "api", "--on", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out.slice(0, 2) }).toEqual({
      code: 0,
      out: ["api: linked to Roadmap (github, PVT_1)", "  push: on"],
    });
    expect(callsOf(daemon, "boardsync.setPush")).toEqual([
      { projectId: "p1", push: true, confirm: true },
    ]);
  });

  test("--on without --confirm sends confirm false and the daemon's refusal is exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.setPush": () =>
        refusal(
          "board_sync_confirm",
          "pushing changes to the board needs your confirmation",
          "bad_request",
        ),
    });
    const run = await flightdeckd(["boardsync", "set-push", "api", "--on"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("needs your confirmation");
    expect(callsOf(daemon, "boardsync.setPush")).toEqual([
      { projectId: "p1", push: true, confirm: false },
    ]);
  });

  test("--off turns it off and needs no confirmation", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.setPush": () => ({ ...LINKED, push: false }),
    });
    const run = await flightdeckd(["boardsync", "set-push", "api", "--off"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: STATUS_LINES });
    expect(callsOf(daemon, "boardsync.setPush")).toEqual([
      { projectId: "p1", push: false, confirm: false },
    ]);
  });

  test("a login without the project scope is the daemon's text and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.setPush": () =>
        refusal(
          "board_sync_scope_missing",
          "the login lacks the project scope: sign in again with it",
        ),
    });
    const run = await flightdeckd(
      ["boardsync", "set-push", "api", "--on", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("lacks the project scope");
  });
});

describe("flightdeckd boardsync sync-now (issue #3540)", () => {
  test("a sync that changed things prints what it did, leaving out the zeros", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.syncNow": () => ({
        status: LINKED,
        report: { ...REPORT, created: 2, moved: 1, conflicts: 1, pushed: 3 },
      }),
    });
    const run = await flightdeckd(["boardsync", "sync-now", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["api: synced", "  created 2, moved 1, conflicts 1, pushed 3"],
      err: [],
    });
    expect(callsOf(daemon, "boardsync.syncNow")).toEqual([{ projectId: "p1" }]);
  });

  test("a sync with nothing to change says so", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "sync-now", "api"], daemon.port);
    expect(run.out).toEqual(["api: synced", "  nothing to change"]);
  });

  test("a board that was not modified, and one with more items than a read takes, say so", async () => {
    const unchanged = fakeDaemon({
      ...OPEN,
      "boardsync.syncNow": () => ({
        status: LINKED,
        report: { ...REPORT, notModified: true },
      }),
    });
    const big = fakeDaemon({
      ...OPEN,
      "boardsync.syncNow": () => ({
        status: LINKED,
        report: { ...REPORT, created: 1, truncated: true },
      }),
    });
    const a = await flightdeckd(["boardsync", "sync-now", "api"], unchanged.port);
    const b = await flightdeckd(["boardsync", "sync-now", "api"], big.port);
    expect({ a: a.out, b: b.out }).toEqual({
      a: ["api: the board has not changed since the last read"],
      b: ["api: synced", "  created 1", "  the board has more items than one pull reads"],
    });
  });

  test("--json prints the status and the report", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "sync-now", "api", "--json"], daemon.port);
    expect({ code: run.code, value: printed(run.out) }).toMatchObject({
      code: 0,
      value: { status: { boardId: "PVT_1", push: false }, report: REPORT },
    });
  });

  test("a board that is not linked is the daemon's text and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.syncNow": () =>
        refusal("board_sync_not_linked", "the project has no linked board"),
    });
    const run = await flightdeckd(["boardsync", "sync-now", "api"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the project has no linked board");
    expect(callsOf(daemon, "boardsync.syncNow")).toEqual([{ projectId: "p1" }]);
  });

  test("text from the daemon in an error cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.syncNow": () => refusal("board_sync_not_linked", "\u001b[2Jwiped"),
    });
    const run = await flightdeckd(["boardsync", "sync-now", "api"], daemon.port);
    expect(run.err.join("\n")).toContain("wiped");
    expect(run.err.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("the arguments of the boardsync write verbs (issue #3540)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => {
    const got = parsed(argv);
    return "refusedWith" in got ? got.refusedWith.split("\n")[0] : "parsed";
  };

  test("link reads a project, a board id and the --map pairs; --host and --json come with it", () => {
    expect(
      parsed([
        "boardsync",
        "link",
        "api",
        "PVT_1",
        "--map",
        "Todo=backlog",
        "--host",
        "pi",
        "--json",
      ]),
    ).toMatchObject({
      command: "boardsync",
      action: "link",
      boardsyncTarget: "api",
      boardsyncBoard: "PVT_1",
      boardsyncMap: { Todo: "backlog" },
      host: "pi",
      json: true,
    });
  });

  test("link without a board id, and a verb with a second operand it does not take, are refused", () => {
    expect([
      refused(["boardsync", "link", "api"]),
      refused(["boardsync", "link"]),
      refused(["boardsync", "unlink", "api", "extra"]),
      refused(["boardsync", "sync-now", "api", "extra"]),
    ]).toEqual([
      "missing the board",
      "missing the project",
      "unknown argument: extra",
      "unknown argument: extra",
    ]);
  });

  test("a --map that is not <status>=<column> is refused before anything is sent", () => {
    const bad = (pair: string) => refused(["boardsync", "set-map", "api", "--map", pair]);
    expect([bad("Todo"), bad("=backlog"), bad("Todo="), bad("Todo=blocked")]).toEqual([
      '--map: needs <status>=<column>, like "Todo=backlog"',
      '--map: needs <status>=<column>, like "Todo=backlog"',
      '--map: needs <status>=<column>, like "Todo=backlog"',
      "--map: the column is one of backlog, in_progress, waiting, review, done",
    ]);
  });

  test("the same status twice in --map is refused", () => {
    expect(
      refused(["boardsync", "set-map", "api", "--map", "Todo=backlog", "--map", "Todo=done"]),
    ).toBe("--map: the status Todo is given twice");
  });

  test("set-map needs at least one --map", () => {
    expect(refused(["boardsync", "set-map", "api"])).toBe("boardsync set-map needs a --map");
  });

  test("--map only applies to link and set-map", () => {
    expect([
      refused(["boardsync", "unlink", "api", "--map", "Todo=backlog"]),
      refused(["boardsync", "sync-now", "api", "--map", "Todo=backlog"]),
      refused(["boardsync", "status", "api", "--map", "Todo=backlog"]),
      refused(["card", "list", "--map", "Todo=backlog"]),
    ]).toEqual(
      Array(4).fill("--map: this flag only applies to flightdeckd boardsync link and set-map"),
    );
  });

  test("set-push needs --on or --off, and not both", () => {
    expect([
      refused(["boardsync", "set-push", "api"]),
      refused(["boardsync", "set-push", "api", "--on", "--off"]),
    ]).toEqual(["boardsync set-push needs --on or --off", "--on or --off, not both"]);
  });

  test("--confirm only comes with set-push --on, and --on and --off only apply to set-push", () => {
    expect([
      refused(["boardsync", "set-push", "api", "--off", "--confirm"]),
      refused(["boardsync", "link", "api", "PVT_1", "--confirm"]),
      refused(["boardsync", "unlink", "api", "--on"]),
      refused(["card", "list", "--off"]),
    ]).toEqual([
      "--confirm: this flag only applies to flightdeckd boardsync set-push --on",
      "--confirm: this flag only applies to flightdeckd boardsync set-push --on",
      "--on: this flag only applies to flightdeckd boardsync set-push",
      "--off: this flag only applies to flightdeckd boardsync set-push",
    ]);
  });

  test("set-push --on --confirm and --off are read as the switch and the typed confirmation", () => {
    expect([
      parsed(["boardsync", "set-push", "api", "--on", "--confirm"]),
      parsed(["boardsync", "set-push", "api", "--off"]),
    ]).toMatchObject([
      { action: "set-push", boardsyncTarget: "api", boardsyncPush: true, confirm: true },
      { action: "set-push", boardsyncTarget: "api", boardsyncPush: false },
    ]);
  });
});
