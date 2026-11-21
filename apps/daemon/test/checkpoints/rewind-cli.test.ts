import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const DONE = {
  via: "snapshot",
  files: [
    { path: "src/a.ts", change: "modified" },
    { path: "src/b.ts", change: "added" },
  ],
  insertions: 5,
  deletions: 2,
};

const OPEN: Handlers = {
  "rewind.apply": () => DONE,
  "rewind.undo": () => DONE,
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

describe("flightdeckd rewind apply and undo (issue #3701)", () => {
  test("apply goes back to a turn and says which files it put back, through what", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["rewind", "apply", "s1", "2", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "s1 rewound to turn 2, through a snapshot: 2 files, +5 -2",
        "  modified src/a.ts",
        "  added src/b.ts",
      ],
      err: [],
    });
    expect(callsOf(daemon, "rewind.apply")).toEqual([
      { claudeSessionId: "s1", turn: 2, confirm: true },
    ]);
  });

  test("undo goes back to the state before the last rewind", async () => {
    const daemon = fakeDaemon({ ...OPEN, "rewind.undo": () => ({ ...DONE, via: "sdk" }) });
    const run = await flightdeckd(["rewind", "undo", "s1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out[0], err: run.err }).toEqual({
      code: 0,
      out: "s1 rewind undone, through the SDK's checkpoint: 2 files, +5 -2",
      err: [],
    });
    expect(callsOf(daemon, "rewind.undo")).toEqual([{ claudeSessionId: "s1", confirm: true }]);
  });

  test("--json prints what the daemon answered", async () => {
    const daemon = fakeDaemon(OPEN);
    const apply = await flightdeckd(
      ["rewind", "apply", "s1", "2", "--confirm", "--json"],
      daemon.port,
    );
    expect(printed(apply.out)).toEqual(DONE);
    const undo = await flightdeckd(["rewind", "undo", "s1", "--confirm", "--json"], daemon.port);
    expect(printed(undo.out)).toEqual(DONE);
  });

  test("without --confirm nothing is sent: exit 1 and the flag named", async () => {
    const daemon = fakeDaemon(OPEN);
    const apply = await flightdeckd(["rewind", "apply", "s1", "2"], daemon.port);
    const undo = await flightdeckd(["rewind", "undo", "s1"], daemon.port);
    expect({ apply: apply.code, undo: undo.code }).toEqual({ apply: 1, undo: 1 });
    expect(apply.err.join("\n")).toContain("rewind apply needs --confirm");
    expect(undo.err.join("\n")).toContain("rewind undo needs --confirm");
    expect(daemon.calls).toEqual([]);
  });

  test("a file of the daemon's cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "rewind.apply": () => ({
        ...DONE,
        files: [{ path: "a\u001b[2Jb.ts", change: "modified" }],
      }),
    });
    const run = await flightdeckd(["rewind", "apply", "s1", "2", "--confirm"], daemon.port);
    expect(run.out.join("\n")).toContain("a [2Jb.ts");
    expect(run.out.join("\n")).not.toContain("\u001b");
  });

  test("a refusal is exit 1 with the daemon's words; a cut connection is exit 2 and may have gone through", async () => {
    const busy = fakeDaemon({
      "rewind.apply": () => ({
        error: {
          code: "invalid_state",
          message: "the session is in a turn: stop it before rewinding",
        },
      }),
    });
    const refused = await flightdeckd(["rewind", "apply", "s1", "2", "--confirm"], busy.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("stop it before rewinding");
    const gone = fakeDaemon({ "rewind.apply": () => CLOSE, "rewind.undo": () => CLOSE });
    for (const argv of [
      ["rewind", "apply", "s1", "2", "--confirm"],
      ["rewind", "undo", "s1", "--confirm"],
    ]) {
      const run = await flightdeckd(argv, gone.port);
      expect(run.code).toBe(2);
      expect(run.err.join("\n")).toContain("may or may not");
    }
  });
});

describe("flightdeckd rewind apply and undo words (issue #3701)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`rewind apply <id> <turn> --confirm` and `rewind undo <id> --confirm`", () => {
    expect(argsOf(["rewind", "apply", "s1", "2", "--confirm", "--host", "pi"])).toMatchObject({
      command: "rewind",
      action: "apply",
      checkpointSession: "s1",
      checkpointTurn: 2,
      rewindConfirm: true,
      host: "pi",
    });
    expect(argsOf(["rewind", "undo", "s1", "--confirm"])).toMatchObject({
      command: "rewind",
      action: "undo",
      checkpointSession: "s1",
      rewindConfirm: true,
    });
  });

  test("a turn on undo, a missing turn on apply and --confirm on a read are refused", () => {
    expect(JSON.stringify(argsOf(["rewind", "undo", "s1", "3", "--confirm"]))).toContain(
      "refusedWith",
    );
    expect(JSON.stringify(argsOf(["rewind", "apply", "s1", "--confirm"]))).toContain(
      "missing the turn number",
    );
    for (const argv of [
      ["rewind", "preview", "s1", "2", "--confirm"],
      ["snapshots", "list", "s1", "--confirm"],
      ["trace", "get", "s1", "--confirm"],
    ]) {
      expect(JSON.stringify(argsOf(argv))).toContain("--confirm");
      expect(argsOf(argv)).toHaveProperty("refusedWith");
    }
  });
});
