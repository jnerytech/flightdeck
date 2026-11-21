import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const UNDO_UNTIL = "2026-11-21T12:05:00.000Z";
const REMOTE = "git@example.com:team/api.git";

const OPEN: Handlers = {
  "changes.revert": () => ({ path: "src/a.ts", undoUntil: UNDO_UNTIL }),
  "changes.undoRevert": () => ({ path: "src/a.ts" }),
  "changes.commit": () => ({
    branch: "fix/a",
    base: "main",
    commit: "9f3c2a1",
    files: ["src/a.ts", "src/b.ts"],
  }),
  "changes.pr": () => ({
    url: "https://github.com/team/api/pull/7",
    branch: "fix/a",
    base: "main",
  }),
};

const COMMIT = [
  "changes",
  "commit",
  "session:s1",
  "--branch",
  "fix/a",
  "--message",
  "Fix the parser",
  "--digest",
  "src/a.ts=d41d8c",
  "--digest",
  "src/b.ts=deleted",
  "--confirm",
];
const PR = [
  "changes",
  "pr",
  "session:s1",
  "--title",
  "Fix the parser",
  "--body",
  "Two files.",
  "--remote",
  REMOTE,
  "--confirm",
];
const REVERT = ["changes", "revert", "session:s1", "src/a.ts", "--confirm"];
const UNDO = ["changes", "undo-revert", "session:s1", "src/a.ts", "--confirm"];

const sent = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type !== "hello");

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

describe("flightdeckd changes revert and undo-revert (issue #3620)", () => {
  test("revert sends the file with the confirmation and says when it can be undone", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(REVERT, daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(sent(daemon)).toEqual([
      {
        type: "changes.revert",
        payload: { target: "session:s1", path: "src/a.ts", confirm: true },
      },
    ]);
    expect(run.out).toEqual([
      `reverted src/a.ts; undo it with \`changes undo-revert session:s1 src/a.ts --confirm\` until ${UNDO_UNTIL}`,
    ]);
    const json = await flightdeckd([...REVERT, "--json"], daemon.port);
    expect(printed(json.out)).toEqual({ path: "src/a.ts", undoUntil: UNDO_UNTIL });
  });

  test("undo-revert sends the file with the confirmation and says it is back", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(UNDO, daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["restored src/a.ts"] });
    expect(sent(daemon)).toEqual([
      {
        type: "changes.undoRevert",
        payload: { target: "session:s1", path: "src/a.ts", confirm: true },
      },
    ]);
    const json = await flightdeckd([...UNDO, "--json"], daemon.port);
    expect(printed(json.out)).toEqual({ path: "src/a.ts" });
  });

  test("a refusal of the daemon is one line on stderr and exit 1", async () => {
    const daemon = fakeDaemon({
      "changes.revert": () => ({ error: { code: "not_found", message: "no such file" } }),
    });
    const run = await flightdeckd(REVERT, daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("no such file");
  });
});

describe("flightdeckd changes commit (issue #3620)", () => {
  test("commits the files with the digests that were typed, and names the branch and the commit", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(COMMIT, daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    // The digests are the ones the person typed: the command never asks `changes.get` for newer ones.
    expect(sent(daemon)).toEqual([
      {
        type: "changes.commit",
        payload: {
          target: "session:s1",
          files: { "src/a.ts": "d41d8c", "src/b.ts": "deleted" },
          message: "Fix the parser",
          branch: "fix/a",
          confirm: true,
        },
      },
    ]);
    expect(run.out).toEqual([
      "committed 9f3c2a1 on fix/a, started from main: 2 files",
      "  src/a.ts",
      "  src/b.ts",
    ]);
    const json = await flightdeckd([...COMMIT, "--json"], daemon.port);
    expect(printed(json.out)).toEqual({
      branch: "fix/a",
      base: "main",
      commit: "9f3c2a1",
      files: ["src/a.ts", "src/b.ts"],
    });
  });

  test("a path that looks like a prototype key stays a plain file of the commit", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      [
        "changes",
        "commit",
        "session:s1",
        "--branch",
        "b",
        "--message",
        "m",
        "--digest",
        "__proto__=d1",
        "--confirm",
      ],
      daemon.port,
    );
    const files = sent(daemon)[0]?.payload.files as Record<string, string>;
    expect(Object.keys(files)).toEqual(["__proto__"]);
  });

  test("a digest that moved is refused as the daemon says, with exit 1 and nothing fetched again", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "changes.commit": () => ({
        error: { code: "changes_commit_stale", message: "src/a.ts changed since you saw it" },
      }),
    });
    const run = await flightdeckd(COMMIT, daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("src/a.ts changed since you saw it");
    expect(sent(daemon).map((c) => c.type)).toEqual(["changes.commit"]);
  });

  test("a host out of reach of the vault networks is refused with exit 1", async () => {
    const daemon = fakeDaemon({
      "changes.commit": () => ({
        error: { code: "transport_refused", message: "this network may not commit" },
      }),
    });
    const run = await flightdeckd(COMMIT, daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("this network may not commit");
  });

  test("a detached checkout is said as such", async () => {
    const daemon = fakeDaemon({
      "changes.commit": () => ({ branch: "fix/a", base: null, commit: "9f3c2a1", files: ["a.ts"] }),
    });
    const run = await flightdeckd(COMMIT, daemon.port);
    expect(run.out[0]).toBe("committed 9f3c2a1 on fix/a, started from a detached HEAD: 1 file");
  });
});

describe("flightdeckd changes pr (issue #3620)", () => {
  test("pushes the branch to the remote that was typed and says where the PR is", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(PR, daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(sent(daemon)).toEqual([
      {
        type: "changes.pr",
        payload: {
          target: "session:s1",
          title: "Fix the parser",
          body: "Two files.",
          remote: REMOTE,
          confirm: true,
        },
      },
    ]);
    expect(run.out).toEqual(["opened https://github.com/team/api/pull/7 (fix/a into main)"]);
    const json = await flightdeckd([...PR, "--json"], daemon.port);
    expect(printed(json.out)).toEqual({
      url: "https://github.com/team/api/pull/7",
      branch: "fix/a",
      base: "main",
    });
  });

  test("a PR with no description sends an empty one", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["changes", "pr", "session:s1", "--title", "T", "--remote", REMOTE, "--confirm"],
      daemon.port,
    );
    expect(sent(daemon)[0]?.payload.body).toBe("");
  });

  test("a remote that moved is refused as the daemon says, with exit 1", async () => {
    const daemon = fakeDaemon({
      "changes.pr": () => ({
        error: { code: "changes_pr_remote", message: "origin is not the address you saw" },
      }),
    });
    const run = await flightdeckd(PR, daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("origin is not the address you saw");
  });

  test("a daemon text cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "changes.pr": () => ({ url: "https://x/\u001b[2Jwiped", branch: "b\u001b[2J", base: "m" }),
    });
    const run = await flightdeckd(PR, daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("a daemon that dies after a change was sent (issue #3620)", () => {
  for (const [name, argv, said] of [
    ["revert", REVERT, "reverted"],
    ["undo-revert", UNDO, "restored"],
    ["commit", COMMIT, "commit"],
    ["pr", PR, "PR"],
  ] as const) {
    test(`${name}: exit 2, and it may or may not have gone through`, async () => {
      const daemon = fakeDaemon({
        "changes.revert": () => CLOSE,
        "changes.undoRevert": () => CLOSE,
        "changes.commit": () => CLOSE,
        "changes.pr": () => CLOSE,
      });
      const run = await flightdeckd(argv, daemon.port);
      expect({ code: run.code, out: run.out }).toEqual({ code: 2, out: [] });
      expect(run.err.join("\n")).toContain("may or may not");
      expect(run.err.join("\n")).toContain(said);
    });
  }
});

describe("flightdeckd changes writes: the words (issue #3620)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => JSON.stringify(argsOf(argv));

  test("the four verbs and what each one takes", () => {
    expect(argsOf(REVERT)).toMatchObject({
      command: "changes",
      action: "revert",
      changesOperand: "session:s1",
      changesPath: "src/a.ts",
      changesConfirm: true,
    });
    expect(argsOf(UNDO)).toMatchObject({ action: "undo-revert", changesPath: "src/a.ts" });
    expect(argsOf(COMMIT)).toMatchObject({
      action: "commit",
      changesBranch: "fix/a",
      changesMessage: "Fix the parser",
      changesDigests: [
        ["src/a.ts", "d41d8c"],
        ["src/b.ts", "deleted"],
      ],
      changesConfirm: true,
    });
    expect(argsOf(PR)).toMatchObject({
      action: "pr",
      changesTitle: "Fix the parser",
      changesBody: "Two files.",
      changesRemote: REMOTE,
      changesConfirm: true,
    });
  });

  test("a write without --confirm is refused before it connects", () => {
    for (const [verb, argv] of [
      ["revert", REVERT],
      ["undo-revert", UNDO],
      ["commit", COMMIT],
      ["pr", PR],
    ] as const)
      expect(refused(argv.filter((word) => word !== "--confirm"))).toContain(
        `changes ${verb} needs --confirm`,
      );
  });

  test("each write names what it needs", () => {
    expect(refused(["changes", "revert", "session:s1", "--confirm"])).toContain("missing the file");
    expect(
      refused(["changes", "commit", "session:s1", "--message", "m", "--branch", "b", "--confirm"]),
    ).toContain("--digest");
    expect(
      refused(["changes", "commit", "session:s1", "--digest", "a=d", "--branch", "b", "--confirm"]),
    ).toContain("--message");
    expect(
      refused([
        "changes",
        "commit",
        "session:s1",
        "--digest",
        "a=d",
        "--message",
        "m",
        "--confirm",
      ]),
    ).toContain("--branch");
    expect(refused(["changes", "pr", "session:s1", "--remote", REMOTE, "--confirm"])).toContain(
      "--title",
    );
    expect(refused(["changes", "pr", "session:s1", "--title", "T", "--confirm"])).toContain(
      "--remote",
    );
  });

  test("a digest is a path and a digest, and a path appears once", () => {
    const withDigest = (...digests: string[]) => [
      "changes",
      "commit",
      "session:s1",
      "--message",
      "m",
      "--branch",
      "b",
      ...digests.flatMap((d) => ["--digest", d]),
      "--confirm",
    ];
    expect(refused(withDigest("src/a.ts"))).toContain("--digest: expected <path>=<digest>");
    expect(refused(withDigest("=d1"))).toContain("--digest: expected <path>=<digest>");
    expect(refused(withDigest("a.ts="))).toContain("--digest: expected <path>=<digest>");
    expect(refused(withDigest("a.ts=d1", "a.ts=d2"))).toContain("--digest: a.ts is given twice");
    // A path may hold an `=`: the digest is what follows the last one.
    expect(argsOf(withDigest("a=b.ts=d1"))).toMatchObject({ changesDigests: [["a=b.ts", "d1"]] });
  });

  test("a flag of another verb, or of another command, is refused", () => {
    expect(refused(["changes", "get", "session:s1", "--confirm"])).toContain(
      "only applies to flightdeckd changes",
    );
    expect(refused([...REVERT, "--branch", "b"])).toContain(
      "--branch: this flag only applies to flightdeckd changes commit",
    );
    expect(refused([...COMMIT, "--title", "T"])).toContain(
      "--title: this flag only applies to flightdeckd changes pr",
    );
    expect(refused([...PR, "--message", "m"])).toContain(
      "--message: this flag only applies to flightdeckd changes commit",
    );
    expect(refused(["costs", "status", "--digest", "a=d"])).toContain(
      "only applies to flightdeckd changes",
    );
    expect(refused(["costs", "status", "--remote", REMOTE])).toContain(
      "only applies to flightdeckd changes",
    );
  });

  test("the flags the card and the persona own still mean what they did", () => {
    expect(refused(["persona", "list", "--body", "b"])).toContain(
      "only applies to flightdeckd persona",
    );
    expect(refused(["costs", "status", "--title", "t"])).toContain(
      "only applies to flightdeckd card",
    );
  });
});
