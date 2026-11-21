import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runChangesCli } from "../../src/review/index.ts";
import { CLOSE, config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { watchedCli } from "../support/cli-watch.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const EDITED = {
  path: "src/a.ts",
  oldPath: null,
  status: "modified",
  additions: 3,
  deletions: 1,
  uncommitted: true,
  binary: false,
  digest: "d41d8c",
  hunks: [],
};

const RESULT = {
  target: "session:s1",
  root: "/work/api",
  base: null,
  position: null,
  hooks: ["pre-commit", "commit-msg"],
  remote: "git@example.com:team/api.git",
  files: [
    EDITED,
    {
      path: "logo.png",
      oldPath: null,
      status: "added",
      additions: 0,
      deletions: 0,
      uncommitted: true,
      binary: true,
      hunks: [],
    },
    {
      path: "lib/new.ts",
      oldPath: "lib/old.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      uncommitted: false,
      binary: false,
      hunks: [],
    },
    {
      path: ".env",
      oldPath: null,
      status: "modified",
      additions: 0,
      deletions: 0,
      uncommitted: true,
      binary: false,
      secret: true,
      hunks: [],
    },
    {
      path: "dump.sql",
      oldPath: null,
      status: "added",
      additions: 0,
      deletions: 0,
      uncommitted: true,
      binary: false,
      tooLarge: true,
      bytes: 2048,
      hunks: [],
    },
  ],
};

const SESSIONS = {
  sessions: [
    {
      claudeSessionId: "s1",
      edits: 4,
      firstAt: "2026-11-21T10:00:00.000Z",
      lastAt: "2026-11-21T10:30:00.000Z",
      title: "Fix the parser",
    },
    {
      claudeSessionId: "s2",
      edits: 1,
      firstAt: "2026-11-21T11:00:00.000Z",
      lastAt: "2026-11-21T11:00:00.000Z",
      title: null,
    },
  ],
};

const OPEN: Handlers = {
  "changes.get": () => RESULT,
  "files.sessions": () => SESSIONS,
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

describe("flightdeckd changes get (issue #3620)", () => {
  test("a session's changes: where they are, the commit hooks, the push address and one line a file with its digest", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["changes", "get", "session:s1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "session:s1: /work/api",
        "base: none, against HEAD",
        "remote: git@example.com:team/api.git",
        "hooks: pre-commit, commit-msg",
        "5 files, +3 -1",
        "  modified src/a.ts +3 -1, uncommitted, digest d41d8c",
        "  added logo.png binary, uncommitted",
        "  renamed lib/new.ts (from lib/old.ts) +0 -0",
        "  modified .env may hold a credential, not read, uncommitted",
        "  added dump.sql too large (2048 bytes), not read, uncommitted",
      ],
      err: [],
    });
    expect(callsOf(daemon, "changes.get")).toEqual([{ target: "session:s1" }]);
  });

  test("a card's changes say where the branch stands against its base; no change is one line", async () => {
    const card = fakeDaemon({
      ...OPEN,
      "changes.get": () => ({
        target: "card:c1",
        root: "/work/c1",
        base: "main",
        position: { ahead: 2, behind: 1 },
        files: [EDITED],
      }),
    });
    const clean = fakeDaemon({
      ...OPEN,
      "changes.get": () => ({ ...RESULT, files: [], hooks: undefined, remote: undefined }),
    });
    expect((await flightdeckd(["changes", "get", "card:c1"], card.port)).out).toEqual([
      "card:c1: /work/c1",
      "base: main, 2 ahead, 1 behind",
      "1 file, +3 -1",
      "  modified src/a.ts +3 -1, uncommitted, digest d41d8c",
    ]);
    expect((await flightdeckd(["changes", "get", "session:s1"], clean.port)).out).toEqual([
      "session:s1: /work/api",
      "base: none, against HEAD",
      "no changes",
    ]);
  });

  test("--json prints every key and the hunks, null where an older daemon sends none", async () => {
    const older = {
      target: "session:s1",
      root: "/work/api",
      base: null,
      position: null,
      files: [
        {
          path: "a.ts",
          oldPath: null,
          status: "modified",
          additions: 1,
          deletions: 0,
          uncommitted: true,
          binary: false,
          hunks: [{ header: "@@ -1 +1 @@", lines: [] }],
        },
      ],
    };
    const daemon = fakeDaemon({ ...OPEN, "changes.get": () => older });
    const run = await flightdeckd(["changes", "get", "session:s1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      target: "session:s1",
      root: "/work/api",
      base: null,
      position: null,
      hooks: [],
      remote: null,
      files: [
        {
          path: "a.ts",
          oldPath: null,
          status: "modified",
          additions: 1,
          deletions: 0,
          uncommitted: true,
          binary: false,
          tooLarge: false,
          bytes: null,
          secret: false,
          digest: null,
          hunks: [{ header: "@@ -1 +1 @@", lines: [] }],
        },
      ],
    });
  });

  test("a target the daemon refuses is one line on stderr and exit 1; a closed connection is exit 2", async () => {
    const unknown = fakeDaemon({
      ...OPEN,
      "changes.get": () => ({ error: { code: "not_found", message: "session not found" } }),
    });
    const gone = fakeDaemon({ ...OPEN, "changes.get": () => CLOSE });
    const refused = await flightdeckd(["changes", "get", "session:nope"], unknown.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("session not found");
    expect((await flightdeckd(["changes", "get", "session:s1"], gone.port)).code).toBe(2);
  });

  test("a path or a remote from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "changes.get": () => ({
        ...RESULT,
        root: "/work/\u001b[2Jwiped",
        files: [{ ...EDITED, path: "a\u001b[2J.ts" }],
      }),
    });
    const run = await flightdeckd(["changes", "get", "session:s1"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd changes sessions (issue #3620)", () => {
  test("the sessions that wrote a file, one line each, and the path it asked about", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["changes", "sessions", "/work/api/src/a.ts"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "/work/api/src/a.ts: 2 sessions wrote it",
        "  s1: 4 edits, first 2026-11-21T10:00:00.000Z, last 2026-11-21T10:30:00.000Z, Fix the parser",
        "  s2: 1 edit, first 2026-11-21T11:00:00.000Z, last 2026-11-21T11:00:00.000Z",
      ],
      err: [],
    });
    expect(callsOf(daemon, "files.sessions")).toEqual([{ path: "/work/api/src/a.ts" }]);
  });

  test("a file no session wrote says so and exits 0", async () => {
    const daemon = fakeDaemon({ ...OPEN, "files.sessions": () => ({ sessions: [] }) });
    const run = await flightdeckd(["changes", "sessions", "/work/api/x.ts"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["/work/api/x.ts: no session wrote it"],
    });
  });

  test("--json prints every key, null for a session with no title", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["changes", "sessions", "/w/a.ts", "--json"], daemon.port);
    expect(printed(run.out)).toEqual(SESSIONS);
  });
});

const watching = (
  daemon: ReturnType<typeof fakeDaemon>,
  options: Parameters<typeof watchedCli>[3] & { json?: boolean },
) =>
  watchedCli(
    daemon,
    "changes.watch",
    (cfg, run) =>
      runChangesCli(
        { action: "watch", target: "session:s1", ...(options.json ? { json: true } : {}) },
        cfg,
        run,
      ),
    options,
  );

describe("flightdeckd changes watch (issue #3620)", () => {
  test("it writes the changes of each update the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "changes.watch": () => ({}) });
    const { result, lines } = await watching(daemon, {
      lines: 2,
      after: () => {
        daemon.push({ type: "changes.updated", ...RESULT });
        daemon.push({ type: "changes.updated", ...RESULT, files: [] });
      },
    });
    // One line an update: the stream flattens a line break.
    expect(lines).toEqual([
      "session:s1: /work/api; base: none, against HEAD; remote: git@example.com:team/api.git; hooks: pre-commit, commit-msg; 5 files, +3 -1; modified src/a.ts +3 -1, uncommitted, digest d41d8c; added logo.png binary, uncommitted; renamed lib/new.ts (from lib/old.ts) +0 -0; modified .env may hold a credential, not read, uncommitted; added dump.sql too large (2048 bytes), not read, uncommitted",
      "session:s1: /work/api; base: none, against HEAD; remote: git@example.com:team/api.git; hooks: pre-commit, commit-msg; no changes",
    ]);
    expect(result.code).toBe(0);
    expect(callsOf(daemon, "changes.watch")).toEqual([{ target: "session:s1" }]);
  });

  test("--json writes one result per line, every key kept and no frame type", async () => {
    const daemon = fakeDaemon({ "changes.watch": () => ({}) });
    const { lines } = await watching(daemon, {
      json: true,
      after: () =>
        daemon.push({
          type: "changes.updated",
          target: "session:s1",
          root: "/work/api",
          base: null,
          position: null,
          files: [],
        }),
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      target: "session:s1",
      root: "/work/api",
      base: null,
      position: null,
      hooks: [],
      remote: null,
      files: [],
    });
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({});
    const lines: string[] = [];
    const result = await runChangesCli(
      { action: "watch", target: "session:s1" },
      config(silent.port),
      { timeoutMs: 200, signal: new AbortController().signal, write: (l) => lines.push(l) },
    );
    expect(result.code).toBe(2);
    expect(lines).toEqual([]);
  });
});

describe("flightdeckd changes words (issue #3620)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`changes get <target>`, `changes sessions <path>` and `changes watch <target>`", () => {
    expect(argsOf(["changes", "get", "card:c1", "--json"])).toMatchObject({
      command: "changes",
      action: "get",
      changesOperand: "card:c1",
      json: true,
    });
    expect(argsOf(["changes", "sessions", "/w/a.ts"])).toMatchObject({
      command: "changes",
      action: "sessions",
      changesOperand: "/w/a.ts",
    });
    expect(argsOf(["changes", "watch", "terminal:t1", "--host", "pi"])).toMatchObject({
      command: "changes",
      action: "watch",
      changesOperand: "terminal:t1",
      host: "pi",
    });
  });

  test("a missing operand, a target that is not one and an unknown verb are refused", () => {
    expect(JSON.stringify(argsOf(["changes", "get"]))).toContain("missing the target");
    expect(JSON.stringify(argsOf(["changes", "sessions"]))).toContain("missing the file");
    expect(JSON.stringify(argsOf(["changes", "get", "main"]))).toContain("invalid target");
    expect(JSON.stringify(argsOf(["changes", "remove", "session:s1"]))).toContain(
      "invalid changes action",
    );
  });
});
