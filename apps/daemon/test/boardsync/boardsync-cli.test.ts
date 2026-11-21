import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const BOARDS = [
  {
    id: "PVT_1",
    title: "Roadmap",
    owner: "acme",
    number: 3,
    url: "https://github.com/orgs/acme/projects/3",
  },
  {
    id: "PVT_2",
    title: "Bugs",
    owner: "jnerytech",
    number: 1,
    url: "https://github.com/users/jnerytech/projects/1",
  },
];

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

const ENTRIES = [
  {
    at: "2026-11-20T08:00:00Z",
    kind: "conflict",
    winner: "local",
    lostValue: "Done",
    lostAt: "2026-11-20T07:00:00Z",
    keptValue: "Doing",
    keptAt: "2026-11-20T08:00:00Z",
    detail: null,
  },
  {
    at: "2026-11-20T09:00:00Z",
    kind: "push_failed",
    winner: null,
    lostValue: null,
    lostAt: null,
    keptValue: null,
    keptAt: null,
    detail: "the board refused the move",
  },
];

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "boardsync.boards": () => ({ boards: BOARDS }),
  "boardsync.status": () => LINKED,
  "boardsync.log": () => ({ entries: ENTRIES }),
};

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd boardsync boards (issue #3540)", () => {
  test("a line a board: its id, who owns it, its number, its title and its link", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "boards"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "PVT_1  acme #3  Roadmap  https://github.com/orgs/acme/projects/3",
        "PVT_2  jnerytech #1  Bugs  https://github.com/users/jnerytech/projects/1",
      ],
      err: [],
    });
    expect(callsOf(daemon, "boardsync.boards")).toEqual([{}]);
  });

  test("an account with no board says so", async () => {
    const daemon = fakeDaemon({ ...OPEN, "boardsync.boards": () => ({ boards: [] }) });
    const run = await flightdeckd(["boardsync", "boards"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["no boards"] });
  });

  test("--json prints the boards as the protocol returns them", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "boards", "--json"], daemon.port);
    expect({ code: run.code, value: printed(run.out) }).toEqual({
      code: 0,
      value: { boards: BOARDS },
    });
  });

  test("a host with no signed-in gh is one line on stderr and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.boards": () => ({
        error: { code: "gh_logged_out", message: "gh is not signed in to GitHub" },
      }),
    });
    const run = await flightdeckd(["boardsync", "boards"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("gh is not signed in to GitHub");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "boardsync.boards": () => CLOSE });
    const run = await flightdeckd(["boardsync", "boards"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("text from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.boards": () => ({
        boards: [{ ...BOARDS[0], title: "\u001b[2Jwiped" }],
      }),
    });
    const run = await flightdeckd(["boardsync", "boards"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd boardsync status (issue #3540)", () => {
  test("a project by name is its board, its push, its last sync and its map, and the request carries the id", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "status", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "api: linked to Roadmap (github, PVT_1)",
        "  push: off",
        "  last sync: 2026-11-20T09:00:00Z",
        "  map: Todo -> backlog, Doing -> in_progress",
        "  statuses: Todo, Doing, Done",
      ],
      err: [],
    });
    expect(callsOf(daemon, "boardsync.status")).toEqual([{ projectId: "p1" }]);
  });

  test("a board that was never read, that failed, that is paused or that has more items than one pull reads says so", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.status": () => ({
        ...LINKED,
        push: true,
        lastSyncedAt: null,
        lastError: "rate limited",
        pausedUntil: "2026-11-20T10:00:00Z",
        truncated: true,
        columnMap: {},
        statusOptions: [],
      }),
    });
    const run = await flightdeckd(["boardsync", "status", "api"], daemon.port);
    expect(run.out).toEqual([
      "api: linked to Roadmap (github, PVT_1)",
      "  push: on",
      "  last sync: never",
      "  paused until: 2026-11-20T10:00:00Z",
      "  last error: rate limited",
      "  the board has more items than one pull reads",
    ]);
  });

  test("a project with no board says so, in text and in --json", async () => {
    const daemon = fakeDaemon({ ...OPEN, "boardsync.status": () => ({ linked: false }) });
    const text = await flightdeckd(["boardsync", "status", "api"], daemon.port);
    const asJson = await flightdeckd(["boardsync", "status", "api", "--json"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 0,
      out: ["api: not linked to a board"],
    });
    expect(printed(asJson.out)).toEqual({
      linked: false,
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
    });
  });

  test("--json keeps every key of a linked project", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "status", "api", "--json"], daemon.port);
    expect(printed(run.out)).toEqual(LINKED);
  });

  test("a name two projects share, or none has, asks the daemon for nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const two = await flightdeckd(["boardsync", "status", "web"], daemon.port);
    const none = await flightdeckd(["boardsync", "status", "nope"], daemon.port);
    expect([two.code, none.code]).toEqual([1, 1]);
    expect(two.err.join("")).toContain("is the name of several projects");
    expect(none.err.join("")).toContain('no project named "nope"');
    expect(callsOf(daemon, "boardsync.status")).toEqual([]);
  });
});

describe("flightdeckd boardsync log (issue #3540)", () => {
  test("a line an entry, in the order the daemon gives, with what was kept, what was lost and why", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "log", "c1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "2026-11-20T08:00:00Z  conflict: local won, kept Doing (2026-11-20T08:00:00Z), lost Done (2026-11-20T07:00:00Z)",
        "2026-11-20T09:00:00Z  push_failed: the board refused the move",
      ],
      err: [],
    });
    expect(callsOf(daemon, "boardsync.log")).toEqual([{ cardId: "c1" }]);
  });

  test("a card with no entry says so", async () => {
    const daemon = fakeDaemon({ ...OPEN, "boardsync.log": () => ({ entries: [] }) });
    const run = await flightdeckd(["boardsync", "log", "c1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["c1: no sync log"] });
  });

  test("--json prints the entries as the protocol returns them", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["boardsync", "log", "c1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ entries: ENTRIES });
  });

  test("a card the daemon does not know is one line on stderr and exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.log": () => ({ error: { code: "not_found", message: "card not found" } }),
    });
    const run = await flightdeckd(["boardsync", "log", "nope"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("card not found");
  });

  test("a detail from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "boardsync.log": () => ({ entries: [{ ...ENTRIES[1], detail: "\u001b[2Jwiped" }] }),
    });
    const run = await flightdeckd(["boardsync", "log", "c1"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("the arguments of the boardsync read verbs (issue #3540)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("each verb reads its operand, --json and --host", () => {
    expect(parsed(["boardsync", "boards", "--json"])).toMatchObject({
      command: "boardsync",
      action: "boards",
      json: true,
    });
    expect(parsed(["boardsync", "status", "api", "--host", "pi"])).toMatchObject({
      command: "boardsync",
      action: "status",
      boardsyncTarget: "api",
      host: "pi",
    });
    expect(parsed(["boardsync", "log", "c1"])).toMatchObject({
      command: "boardsync",
      action: "log",
      boardsyncTarget: "c1",
    });
  });

  test("a missing operand, an unknown verb or a second operand is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["boardsync", "status"]))).toContain("missing the project");
    expect(JSON.stringify(parsed(["boardsync", "log"]))).toContain("missing the card");
    expect(JSON.stringify(parsed(["boardsync"]))).toContain("invalid boardsync action");
    expect(JSON.stringify(parsed(["boardsync", "frobnicate"]))).toContain(
      "invalid boardsync action",
    );
    expect(JSON.stringify(parsed(["boardsync", "boards", "extra"]))).toContain(
      "unknown argument: extra",
    );
    expect(JSON.stringify(parsed(["boardsync", "status", "a", "b"]))).toContain(
      "unknown argument: b",
    );
  });
});
