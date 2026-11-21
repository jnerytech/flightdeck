import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const PROJECT = { id: "p1", name: "api" };

const item = (over: Record<string, unknown> = {}) => ({
  projectId: "p1",
  projectName: "api",
  path: "/w/api/k1",
  branch: "fd/k1",
  cardId: "k1",
  cardTitle: "Fix login",
  column: "review",
  prState: null,
  dirty: true,
  unpushed: 2,
  sizeBytes: 5_242_880,
  lastActivity: "2026-11-20T09:00:00Z",
  idleDays: 1,
  blockers: ["dirty", "unpushed"],
  suggested: false,
  ...over,
});

const RESULT = {
  worktrees: [
    item(),
    item({
      path: "/w/api/k2",
      branch: null,
      cardId: null,
      cardTitle: null,
      column: null,
      dirty: false,
      unpushed: 0,
      sizeBytes: null,
      idleDays: 12,
      blockers: [],
      suggested: true,
    }),
  ],
  disks: [{ projectId: "p1", totalBytes: 100_000_000_000, freeBytes: 40_000_000_000 }],
};

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [PROJECT], maxParallelRuns: 2 }),
  "worktree.list": () => RESULT,
  ...over,
});

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** What the command printed as JSON, or null when it is none: a wrong print fails an assertion, not a parse. */
function printed(out: string[]): unknown {
  try {
    return JSON.parse(out.join("\n"));
  } catch {
    return null;
  }
}

describe("flightdeckd worktree list (issue #3702)", () => {
  test("a worktree is a line with its path, project, branch, card, state, size and idle days", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "/w/api/k1  api  fd/k1  card k1  dirty, 2 unpushed  5.0 MB  idle 1 d  blocked: dirty, unpushed",
      "/w/api/k2  api  no branch  no card  clean, 0 unpushed  size unknown  idle 12 d  suggested",
      "disk api: 37.3 GB free of 93.1 GB",
    ]);
  });

  test("without a project it asks for every project", async () => {
    const daemon = fakeDaemon(base());
    await flightdeckd(["worktree", "list"], daemon.port);
    expect(callsOf(daemon, "worktree.list")).toEqual([{}]);
    expect(callsOf(daemon, "project.list")).toEqual([]);
  });

  test("a project, by name, is sent as its id", async () => {
    const daemon = fakeDaemon(base());
    await flightdeckd(["worktree", "list", "api"], daemon.port);
    expect(callsOf(daemon, "worktree.list")).toEqual([{ projectId: "p1" }]);
  });

  test("a project the host does not know exits 1 and asks for no worktree", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["worktree", "list", "nope"], daemon.port);
    expect(run.code).toBe(1);
    expect(callsOf(daemon, "worktree.list")).toEqual([]);
  });

  test("--json keeps every key and a size that is not known stays null, never 0", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["worktree", "list", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual(RESULT);
  });

  test("no worktree says so", async () => {
    const daemon = fakeDaemon(base({ "worktree.list": () => ({ worktrees: [], disks: [] }) }));
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["no worktrees"] });
  });

  test("no worktree still says what the disk has left", async () => {
    const daemon = fakeDaemon(
      base({ "worktree.list": () => ({ worktrees: [], disks: RESULT.disks }) }),
    );
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["no worktrees", "disk p1: 37.3 GB free of 93.1 GB"],
    });
  });

  test("a path or a branch that holds terminal controls cannot drive the terminal", async () => {
    const daemon = fakeDaemon(
      base({
        "worktree.list": () => ({
          worktrees: [item({ path: "/w/\u001b[2Jwiped", branch: "fd/\u001b]0;x\u0007k" })],
          disks: [],
        }),
      }),
    );
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a card title with accents and emoji is not changed", async () => {
    const daemon = fakeDaemon(
      base({ "worktree.list": () => ({ worktrees: [item({ path: "/w/ação 🙂" })], disks: [] }) }),
    );
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect(run.out[0]?.startsWith("/w/ação 🙂  ")).toBe(true);
  });

  test("a daemon that refuses is its text on stderr and exit 1", async () => {
    const daemon = fakeDaemon(
      base({ "worktree.list": () => ({ error: { code: "forbidden", message: "not allowed" } }) }),
    );
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("not allowed");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon(base({ "worktree.list": () => CLOSE }));
    const run = await flightdeckd(["worktree", "list"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("no daemon at all is exit 2", async () => {
    const run = await flightdeckd(["worktree", "list"], 1);
    expect(run.code).toBe(2);
  });
});

describe("flightdeckd worktree arguments (issue #3702)", () => {
  test("list takes an optional project, --json and --host", () => {
    expect(parseArgs(["worktree", "list", "api", "--json", "--host", "pi"])).toMatchObject({
      command: "worktree",
      action: "list",
      worktreeProject: "api",
      json: true,
      host: "pi",
    });
    expect(parseArgs(["worktree", "list"]).worktreeProject).toBeUndefined();
  });

  test("--query is refused on worktree list, which has no text to look for", () => {
    expect(() => parseArgs(["worktree", "list", "--query", "x"])).toThrow(
      "this flag only applies to flightdeckd issues list",
    );
  });

  test("an unknown worktree action is refused", () => {
    expect(() => parseArgs(["worktree", "frobnicate"])).toThrow("invalid worktree action");
  });
});

const OUTCOME = {
  removed: [
    { path: "/w/api/k2", freedBytes: 5_242_880, branchKept: false },
    { path: "/w/api/k3", freedBytes: null, branchKept: false },
    { path: "/w/api/k4", freedBytes: 1_048_576, branchKept: true },
  ],
  kept: [
    { path: "/w/api/k1", reason: "dirty" },
    { path: "/w/api/k5", reason: "failed", detail: "git said no" },
    { path: "/w/api/k6", reason: "not_listed" },
  ],
};

const removing = (over: Handlers = {}): Handlers =>
  base({ "worktree.remove": () => OUTCOME, ...over });

const remove = (...rest: string[]) => ["worktree", "remove", "api", ...rest];

describe("flightdeckd worktree remove (issue #3702)", () => {
  test("every path of the project goes to the daemon in one request, with the confirmation", async () => {
    const daemon = fakeDaemon(removing());
    await flightdeckd(remove("/w/api/k1", "/w/api/k2", "--confirm"), daemon.port);
    expect(callsOf(daemon, "worktree.remove")).toEqual([
      {
        items: [
          { projectId: "p1", path: "/w/api/k1" },
          { projectId: "p1", path: "/w/api/k2" },
        ],
        confirm: true,
      },
    ]);
  });

  test("it says what went, what it freed and which branch stayed, and what the daemon kept and why", async () => {
    const daemon = fakeDaemon(removing());
    const run = await flightdeckd(remove("/w/api/k2", "--confirm"), daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "removed /w/api/k2  freed 5.0 MB",
      "removed /w/api/k3  size unknown",
      "removed /w/api/k4  freed 1.0 MB  branch kept",
      "kept /w/api/k1  dirty",
      "kept /w/api/k5  failed: git said no",
      "kept /w/api/k6  not_listed",
    ]);
  });

  test("a worktree the daemon keeps is still exit 0: the daemon answered, and the line says it stayed", async () => {
    const daemon = fakeDaemon(
      removing({ "worktree.remove": () => ({ removed: [], kept: [OUTCOME.kept[0]] }) }),
    );
    const run = await flightdeckd(remove("/w/api/k1", "--confirm"), daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["kept /w/api/k1  dirty"] });
  });

  test("without --confirm it is refused before it connects: exit 1, not 2, and the text names the flag", async () => {
    const run = await flightdeckd(remove("/w/api/k1"), 1);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("--confirm");
  });

  test("a project the host does not know exits 1 and removes nothing", async () => {
    const daemon = fakeDaemon(removing());
    const run = await flightdeckd(
      ["worktree", "remove", "nope", "/w/api/k1", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(callsOf(daemon, "worktree.remove")).toEqual([]);
  });

  test("--json keeps every key: a size that is not known and a branch flag the daemon left out are null", async () => {
    const daemon = fakeDaemon(
      removing({
        "worktree.remove": () => ({
          removed: [{ path: "/w/api/k3", freedBytes: null }],
          kept: [{ path: "/w/api/k1", reason: "dirty" }],
        }),
      }),
    );
    const run = await flightdeckd(
      remove("/w/api/k3", "/w/api/k1", "--confirm", "--json"),
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      removed: [{ path: "/w/api/k3", freedBytes: null, branchKept: null }],
      kept: [{ path: "/w/api/k1", reason: "dirty", detail: null }],
    });
  });

  test("a path or a detail that holds terminal controls cannot drive the terminal, and accents and emoji stay", async () => {
    const daemon = fakeDaemon(
      removing({
        "worktree.remove": () => ({
          removed: [{ path: "/w/ação 🙂", freedBytes: 0, branchKept: false }],
          kept: [{ path: "/w/\u001b[2Jwiped", reason: "failed", detail: "a\u001b]0;x\u0007b" }],
        }),
      }),
    );
    const run = await flightdeckd(remove("/w/x", "--confirm"), daemon.port);
    expect(run.out.join("\n")).toContain("/w/ação 🙂");
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a daemon that refuses is its text on stderr and exit 1, with no word that the removal may have happened", async () => {
    const daemon = fakeDaemon(
      removing({
        "worktree.remove": () => ({ error: { code: "forbidden", message: "not allowed" } }),
      }),
    );
    const run = await flightdeckd(remove("/w/api/k1", "--confirm"), daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("not allowed");
    expect(run.err.join("\n")).not.toContain("may or may not");
  });

  test("a connection that closes after the request went out says the folders may or may not be gone, exit 2", async () => {
    const daemon = fakeDaemon(removing({ "worktree.remove": () => CLOSE }));
    const run = await flightdeckd(remove("/w/api/k1", "--confirm"), daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not have been removed");
    expect(run.err.join("\n")).toContain("worktree list");
  });

  test("no daemon at all is exit 2 and does not say anything was removed", async () => {
    const run = await flightdeckd(remove("/w/api/k1", "--confirm"), 1);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).not.toContain("may or may not");
  });
});

/** What the parser made of a command line, or the text it refused with: a wrong parse fails an assertion, not a throw. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return String(error);
  }
}

describe("flightdeckd worktree remove arguments (issue #3702)", () => {
  test("remove takes the project, every path up to the next flag, --confirm, --json and --host", () => {
    expect(
      parsed(["worktree", "remove", "api", "/w/a", "/w/b", "--confirm", "--json", "--host", "pi"]),
    ).toMatchObject({
      command: "worktree",
      action: "remove",
      worktreeProject: "api",
      worktreePaths: ["/w/a", "/w/b"],
      confirm: true,
      json: true,
      host: "pi",
    });
  });

  test.each([".", "..", "api-card-1", "", "./a"])(
    "the relative path %p is refused: the host would resolve it against its own folder, not the person's",
    (path) => {
      const text = String(parsed(["worktree", "remove", "api", path, "--confirm"]));
      expect(text).toContain("absolute");
    },
  );

  test("an absolute path, POSIX or Windows, is taken", () => {
    expect(
      parsed(["worktree", "remove", "api", "/w/a", "C:\\w\\b", "D:/w/c", "--confirm"]),
    ).toMatchObject({ worktreePaths: ["/w/a", "C:\\w\\b", "D:/w/c"] });
  });

  test("a path typed twice is sent once, so the answer does not say removed and not_listed for one folder", () => {
    expect(
      parsed(["worktree", "remove", "api", "/w/a", "/w/b", "/w/a", "--confirm"]),
    ).toMatchObject({ worktreePaths: ["/w/a", "/w/b"] });
  });

  test("a path typed after a flag is refused, never dropped: the removal would otherwise miss a folder the person named", () => {
    expect(parsed(["worktree", "remove", "api", "/w/a", "--confirm", "/w/b"])).toContain(
      "unknown argument: /w/b",
    );
  });

  test("remove without a project, or without a path, is refused", () => {
    expect(parsed(["worktree", "remove", "--confirm"])).toContain("the project");
    expect(parsed(["worktree", "remove", "api", "--confirm"])).toContain("worktree remove");
    expect(parsed(["worktree", "remove", "api", "--confirm"])).toContain("path");
  });

  test("--confirm on worktree list is refused, since list changes nothing", () => {
    expect(parsed(["worktree", "list", "--confirm"])).toContain("--confirm");
  });
});
