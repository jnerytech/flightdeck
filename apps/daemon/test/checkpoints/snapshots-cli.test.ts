import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SNAP = {
  claudeSessionId: "s1",
  ref: "refs/flightdeck/s1/1",
  tree: "abc",
  turnUuid: "u1",
  repo: "/work/api",
};

const LIST = {
  snapshots: [
    {
      ...SNAP,
      n: 1,
      kind: "before",
      prompt: "Fix the parser",
      createdAt: "2026-11-21T10:00:00.000Z",
    },
    { ...SNAP, n: 2, kind: "after", prompt: null, createdAt: "2026-11-21T10:05:00.000Z" },
  ],
};

const FILES = {
  files: [
    { path: "src/a.ts", change: "modified" },
    { path: "src/b.ts", change: "added" },
  ],
  insertions: 5,
  deletions: 2,
};

const OPEN: Handlers = {
  "snapshots.list": () => LIST,
  "snapshots.files": () => FILES,
  "rewind.preview": () => ({ via: "snapshot", ...FILES }),
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

describe("flightdeckd snapshots list (issue #3701)", () => {
  test("one line a snapshot: its number, kind, time and the prompt it came from", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["snapshots", "list", "s1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "s1: 2 snapshots",
        "  1 before 2026-11-21T10:00:00.000Z Fix the parser",
        "  2 after 2026-11-21T10:05:00.000Z",
      ],
      err: [],
    });
    expect(callsOf(daemon, "snapshots.list")).toEqual([{ claudeSessionId: "s1" }]);
  });

  test("--json keeps every snapshot with null where it has no prompt, and no repository path or ref", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["snapshots", "list", "s1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({
      snapshots: [
        {
          n: 1,
          kind: "before",
          turnUuid: "u1",
          prompt: "Fix the parser",
          createdAt: "2026-11-21T10:00:00.000Z",
        },
        {
          n: 2,
          kind: "after",
          turnUuid: "u1",
          prompt: null,
          createdAt: "2026-11-21T10:05:00.000Z",
        },
      ],
    });
  });

  test("a session with none says so, and --json is an empty list", async () => {
    const daemon = fakeDaemon({ ...OPEN, "snapshots.list": () => ({ snapshots: [] }) });
    const text = await flightdeckd(["snapshots", "list", "s1"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["s1: no snapshots"] });
    const asJson = await flightdeckd(["snapshots", "list", "s1", "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual({ snapshots: [] });
  });

  test("a prompt from the transcript cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "snapshots.list": () => ({
        snapshots: [{ ...LIST.snapshots[0], prompt: "a\u001b[2Jwiped" }],
      }),
    });
    const run = await flightdeckd(["snapshots", "list", "s1"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a refusal is one line on stderr and exit 1; a closed connection is exit 2", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "snapshots.list": () => ({ error: { code: "not_found", message: "session not found" } }),
    });
    const gone = fakeDaemon({ ...OPEN, "snapshots.list": () => CLOSE });
    const refused = await flightdeckd(["snapshots", "list", "nope"], refusing.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("session not found");
    expect((await flightdeckd(["snapshots", "list", "s1"], gone.port)).code).toBe(2);
  });
});

describe("flightdeckd snapshots files and rewind preview (issue #3701)", () => {
  test("the files a turn changed and the lines added and removed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["snapshots", "files", "s1", "2"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["s1 turn 2: 2 files, +5 -2", "  modified src/a.ts", "  added src/b.ts"],
      err: [],
    });
    expect(callsOf(daemon, "snapshots.files")).toEqual([{ claudeSessionId: "s1", n: 2 }]);
  });

  test("a rewind preview says what it would change and through what; nothing is sent but the question", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["rewind", "preview", "s1", "2"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "s1 rewind to turn 2, through a snapshot: 2 files, +5 -2",
        "  modified src/a.ts",
        "  added src/b.ts",
      ],
      err: [],
    });
    expect(daemon.calls.map((c) => c.type)).not.toContain("rewind.apply");
    expect(callsOf(daemon, "rewind.preview")).toEqual([{ claudeSessionId: "s1", turn: 2 }]);
    const asJson = await flightdeckd(["rewind", "preview", "s1", "2", "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual({ via: "snapshot", ...FILES });
  });

  test("no file changed is one line, and a path from the daemon cannot drive the terminal", async () => {
    const none = fakeDaemon({
      ...OPEN,
      "snapshots.files": () => ({ files: [], insertions: 0, deletions: 0 }),
    });
    const empty = await flightdeckd(["snapshots", "files", "s1", "3"], none.port);
    expect(empty.out).toEqual(["s1 turn 3: no file changed"]);
    const hostile = fakeDaemon({
      ...OPEN,
      "rewind.preview": () => ({
        via: "sdk",
        files: [{ path: "a\u001b[2J.ts", change: "modified" }],
        insertions: 1,
        deletions: 0,
      }),
    });
    const run = await flightdeckd(["rewind", "preview", "s1", "1"], hostile.port);
    expect(run.out.join("\n")).toContain("through the SDK's checkpoint");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a turn the daemon refuses is exit 1 with its words", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "rewind.preview": () => ({ error: { code: "not_found", message: "no snapshot for turn 9" } }),
    });
    const run = await flightdeckd(["rewind", "preview", "s1", "9"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("no snapshot for turn 9");
  });
});

describe("flightdeckd snapshots and rewind words (issue #3701)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`snapshots list <id>`, `snapshots files <id> <n>` and `rewind preview <id> <turn>`", () => {
    expect(argsOf(["snapshots", "list", "s1", "--json"])).toMatchObject({
      command: "snapshots",
      action: "list",
      checkpointSession: "s1",
      json: true,
    });
    expect(argsOf(["snapshots", "files", "s1", "2"])).toMatchObject({
      command: "snapshots",
      action: "files",
      checkpointSession: "s1",
      checkpointTurn: 2,
    });
    expect(argsOf(["rewind", "preview", "s1", "0", "--host", "pi"])).toMatchObject({
      command: "rewind",
      action: "preview",
      checkpointTurn: 0,
      host: "pi",
    });
  });

  test("a missing id or turn, a turn that is not a whole number and an unknown verb are refused", () => {
    expect(JSON.stringify(argsOf(["snapshots", "list"]))).toContain(
      "missing the Claude session id",
    );
    expect(JSON.stringify(argsOf(["snapshots", "files", "s1"]))).toContain(
      "missing the turn number",
    );
    for (const turn of ["two", "-1", "1.5", "99999999999999999999"]) {
      expect(JSON.stringify(argsOf(["rewind", "preview", "s1", turn]))).toContain(
        "invalid turn number",
      );
    }
    expect(JSON.stringify(argsOf(["snapshots", "remove", "s1"]))).toContain(
      "invalid snapshots action",
    );
    expect(JSON.stringify(argsOf(["rewind", "remove", "s1", "1"]))).toContain(
      "invalid rewind action",
    );
  });
});
