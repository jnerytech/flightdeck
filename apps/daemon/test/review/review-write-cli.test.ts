import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const COMMENT = {
  id: "c9",
  target: "card:k1",
  path: "src/a.ts",
  side: "new",
  lineStart: 10,
  lineEnd: 12,
  quote: "const a = 1;",
  body: "why?",
  state: "draft",
  createdAt: "2026-11-20T09:00:00Z",
  sentAt: null,
  outdated: false,
};

const OPEN: Handlers = {
  "review.add": () => COMMENT,
  "review.update": () => ({ ...COMMENT, id: "c1", body: "better" }),
  "review.remove": () => ({}),
  "review.send": () => ({ via: "session", text: "Review of 2 comments", comments: 2 }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const refused = (code: string, message: string) => ({ error: { code, message } });

const ADD = [
  "review",
  "add",
  "card:k1",
  "--path",
  "src/a.ts",
  "--lines",
  "10-12",
  "--body",
  "why?",
];

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

describe("flightdeckd review add (issue #3619)", () => {
  test("sends the target, the file, the side, the lines and the body, and prints the new comment", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(ADD, daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["added c9  src/a.ts:10-12 new"],
      err: [],
    });
    expect(callsOf(daemon, "review.add")).toEqual([
      {
        target: "card:k1",
        path: "src/a.ts",
        side: "new",
        lineStart: 10,
        lineEnd: 12,
        body: "why?",
      },
    ]);
  });

  test("one line is a range that starts and ends there, and --side old is the old side", async () => {
    const daemon = fakeDaemon({ ...OPEN, "review.add": () => ({ ...COMMENT, side: "old" }) });
    const run = await flightdeckd(
      [
        "review",
        "add",
        "card:k1",
        "--path",
        "src/a.ts",
        "--lines",
        "7",
        "--side",
        "old",
        "--body",
        "x",
      ],
      daemon.port,
    );
    expect(callsOf(daemon, "review.add")).toEqual([
      { target: "card:k1", path: "src/a.ts", side: "old", lineStart: 7, lineEnd: 7, body: "x" },
    ]);
    expect(run.code).toBe(0);
  });

  test("a body with accents, emoji and a line break goes as typed", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      [
        "review",
        "add",
        "card:k1",
        "--path",
        "a.ts",
        "--lines",
        "1",
        "--body",
        "não é assim 🙂\nlinha 2",
      ],
      daemon.port,
    );
    expect(callsOf(daemon, "review.add")[0]).toMatchObject({ body: "não é assim 🙂\nlinha 2" });
  });

  test("--json prints the comment with every key", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd([...ADD, "--json"], daemon.port);
    expect({ code: run.code, value: printed(run.out) }).toEqual({
      code: 0,
      value: { ...COMMENT, author: null, severity: null },
    });
  });

  test("lines the file does not have are the daemon's refusal: exit 1 and its text", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "review.add": () => refused("review_lines_invalid", "lines 10–12 are outside src/a.ts"),
    });
    const run = await flightdeckd(ADD, daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("lines 10–12 are outside src/a.ts");
  });

  test("a project target is the daemon's refusal: exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "review.add": () =>
        refused("review_target_invalid", "a project target takes no review comment"),
    });
    const run = await flightdeckd(
      ["review", "add", "project:p1", "--path", "a.ts", "--lines", "1", "--body", "x"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("a project target takes no review comment");
  });

  test("a daemon that closes the connection is exit 2, and says the comment may be there", async () => {
    const daemon = fakeDaemon({ ...OPEN, "review.add": () => CLOSE });
    const run = await flightdeckd(ADD, daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
    expect(run.err.join("\n")).toContain("review list");
  });
});

describe("flightdeckd review update (issue #3619)", () => {
  test("sends the comment and the new text, and prints the comment", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "update", "c1", "--body", "better"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["updated c1  src/a.ts:10-12 new"],
      err: [],
    });
    expect(callsOf(daemon, "review.update")).toEqual([{ id: "c1", body: "better" }]);
  });

  test("a comment already sent is the daemon's refusal: exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "review.update": () => refused("review_comment_sent", "the comment was already sent"),
    });
    const run = await flightdeckd(["review", "update", "c1", "--body", "x"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the comment was already sent");
  });

  test("an update the daemon cannot find again is exit 1 with one line on stderr, never a success", async () => {
    const daemon = fakeDaemon({ ...OPEN, "review.update": () => null });
    const run = await flightdeckd(["review", "update", "c1", "--body", "x"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 1,
      out: [],
      err: ["comment c1 no longer exists"],
    });
  });

  test("--json prints the comment", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["review", "update", "c1", "--body", "better", "--json"],
      daemon.port,
    );
    expect((printed(run.out) as { body: string }).body).toBe("better");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "review.update": () => CLOSE });
    const run = await flightdeckd(["review", "update", "c1", "--body", "x"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});

describe("flightdeckd review remove (issue #3619)", () => {
  test("sends the comment and says it is gone", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "remove", "c1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["removed c1"],
      err: [],
    });
    expect(callsOf(daemon, "review.remove")).toEqual([{ id: "c1" }]);
  });

  test("--json prints the id", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "remove", "c1", "--json"], daemon.port);
    expect({ code: run.code, value: printed(run.out) }).toEqual({ code: 0, value: { id: "c1" } });
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "review.remove": () => CLOSE });
    const run = await flightdeckd(["review", "remove", "c1"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});

describe("flightdeckd review send (issue #3619)", () => {
  test("with --confirm it sends the target and says how many comments went where", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "send", "card:k1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["sent 2 comments to the session"],
      err: [],
    });
    expect(callsOf(daemon, "review.send")).toEqual([{ target: "card:k1" }]);
  });

  test("one comment is said in the singular, and a card or a terminal is named", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "review.send": () => ({ via: "terminal", text: "Review", comments: 1 }),
    });
    const run = await flightdeckd(["review", "send", "session:s1", "--confirm"], daemon.port);
    expect(run.out).toEqual(["sent 1 comment to the terminal"]);
  });

  test("--language goes with the request", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["review", "send", "card:k1", "--language", "pt-BR", "--confirm"],
      daemon.port,
    );
    expect(callsOf(daemon, "review.send")).toEqual([{ target: "card:k1", language: "pt-BR" }]);
  });

  test("without --confirm nothing is sent: exit 1 and the flag is named", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "send", "card:k1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("--confirm");
    expect(callsOf(daemon, "review.send")).toEqual([]);
  });

  test("a session that takes no messages gets its review as text to copy", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "review.send": () => ({
        via: "copy",
        text: "Review\n- a.ts:1 fix\u001b[2J this",
        comments: 1,
      }),
    });
    const run = await flightdeckd(["review", "send", "session:s1", "--confirm"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out[0]).toBe("sent 1 comment, but nobody takes it: copy the review below");
    expect(run.out.slice(1)).toEqual(["Review", "- a.ts:1 fix  this"]);
  });

  test("--json prints the answer as the protocol returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["review", "send", "card:k1", "--confirm", "--json"],
      daemon.port,
    );
    expect({ code: run.code, value: printed(run.out) }).toEqual({
      code: 0,
      value: { via: "session", text: "Review of 2 comments", comments: 2 },
    });
  });

  test("a target with no draft is the daemon's refusal: exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "review.send": () => refused("review_no_drafts", "no comment in draft"),
    });
    const run = await flightdeckd(["review", "send", "card:k1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("no comment in draft");
  });

  test("a daemon that closes the connection is exit 2, and says to look at the session first", async () => {
    const daemon = fakeDaemon({ ...OPEN, "review.send": () => CLOSE });
    const run = await flightdeckd(["review", "send", "card:k1", "--confirm"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("look at the session");
  });
});

describe("flightdeckd review arguments (issue #3619)", () => {
  /** The parsed arguments, or `{ error }` with the refusal's first line, so a wrong parse fails an assertion. */
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { error: (error as Error).message.split("\n")[0] ?? "" };
    }
  };

  const refusal = (argv: string[]) => {
    try {
      parseArgs(argv);
      return null;
    } catch (error) {
      return (error as Error).message.split("\n")[0] ?? "";
    }
  };

  test("add reads the target, the file, the lines, the side and the body", () => {
    expect(parsed([...ADD, "--side", "old"])).toMatchObject({
      command: "review",
      action: "add",
      reviewTarget: "card:k1",
      reviewPath: "src/a.ts",
      reviewLines: { start: 10, end: 12 },
      reviewSide: "old",
      body: "why?",
    });
  });

  test("a single line is a range that starts and ends there", () => {
    expect(
      parsed(["review", "add", "card:k1", "--path", "a.ts", "--lines", "7", "--body", "x"]),
    ).toMatchObject({ reviewLines: { start: 7, end: 7 } });
  });

  test("update and remove take the comment, send takes the target, the language and --confirm", () => {
    expect(parsed(["review", "update", "c1", "--body", "x"])).toMatchObject({
      action: "update",
      reviewComment: "c1",
      body: "x",
    });
    expect(parsed(["review", "remove", "c1"])).toMatchObject({
      action: "remove",
      reviewComment: "c1",
    });
    expect(
      parseArgs(["review", "send", "card:k1", "--language", "pt-BR", "--confirm"]),
    ).toMatchObject({
      action: "send",
      reviewTarget: "card:k1",
      language: "pt-BR",
      confirm: true,
    });
  });

  test("a line range that is not two whole numbers in order is refused before anything is sent", () => {
    const bad = [
      "0",
      "12-10",
      "10-",
      "-3",
      "abc",
      "1-2-3",
      "1.5",
      "99999999999999999999",
      "0-3",
      "",
    ];
    const faults = bad.map((lines) =>
      refusal(["review", "add", "card:k1", "--path", "a.ts", "--lines", lines, "--body", "x"]),
    );
    expect(faults.map((fault) => fault?.startsWith("--lines:") ?? false)).toEqual(
      bad.map(() => true),
    );
  });

  test("a side that is not new or old is refused", () => {
    expect(
      refusal([
        "review",
        "add",
        "card:k1",
        "--path",
        "a.ts",
        "--lines",
        "1",
        "--side",
        "left",
        "--body",
        "x",
      ]),
    ).toStartWith("--side:");
  });

  test("add needs the file, the lines and the body; update needs the body; send needs --confirm", () => {
    expect([
      refusal(["review", "add", "card:k1", "--lines", "1", "--body", "x"]),
      refusal(["review", "add", "card:k1", "--path", "a.ts", "--body", "x"]),
      refusal(["review", "add", "card:k1", "--path", "a.ts", "--lines", "1"]),
      refusal(["review", "update", "c1"]),
      refusal(["review", "send", "card:k1"]),
    ]).toEqual([
      "review add needs --path",
      "review add needs --lines",
      "review add needs --body",
      "review update needs --body",
      "--confirm: review send needs it, since it puts the drafts into a session",
    ]);
  });

  test("an empty or blank body is refused", () => {
    expect([
      refusal(["review", "update", "c1", "--body", ""]),
      refusal(["review", "update", "c1", "--body", "   "]),
    ]).toEqual(["--body: needs text", "--body: needs text"]);
  });

  test("a flag of one verb is refused on the others", () => {
    expect(
      [
        refusal(["review", "list", "card:k1", "--path", "a.ts"]),
        refusal(["review", "remove", "c1", "--body", "x"]),
        refusal(["review", "send", "card:k1", "--body", "x", "--confirm"]),
        refusal([
          "review",
          "add",
          "card:k1",
          "--path",
          "a.ts",
          "--lines",
          "1",
          "--body",
          "x",
          "--language",
          "en",
        ]),
        refusal(["review", "list", "card:k1", "--confirm"]),
        refusal(["review", "update", "c1", "--body", "x", "--lines", "3"]),
      ].map((fault) => fault?.split(":")[0]),
    ).toEqual(["--path", "--body", "--body", "--language", "--confirm", "--lines"]);
  });

  test("the flags of review are refused on another command", () => {
    expect(
      [
        refusal(["card", "list", "--path", "a.ts"]),
        refusal(["card", "list", "--lines", "3"]),
        refusal(["card", "list", "--side", "new"]),
        refusal(["rules", "list", "--confirm"]),
      ].map((fault) => fault?.split(":")[0]),
    ).toEqual(["--path", "--lines", "--side", "--confirm"]);
  });

  test("--body and --language on review are not taken for the persona's or the card's", () => {
    expect(refusal(["review", "update", "c1", "--body", "x"])).toBeNull();
    expect(refusal(["review", "send", "card:k1", "--language", "en", "--confirm"])).toBeNull();
  });
});
