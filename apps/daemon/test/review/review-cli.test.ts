import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const comment = (over: Record<string, unknown> = {}) => ({
  id: "c1",
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
  ...over,
});

const COMMENTS = [
  comment(),
  comment({ id: "c2", path: "src/b.ts", side: "old", lineStart: 4, lineEnd: 4, body: "rename" }),
  comment({
    id: "c3",
    state: "sent",
    sentAt: "2026-11-20T10:00:00Z",
    outdated: true,
    body: "first line\nsecond line",
    author: "reviewer",
    severity: "high",
  }),
];

const OPEN: Handlers = { "review.list": () => ({ comments: COMMENTS }) };

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

describe("flightdeckd review list (issue #3619)", () => {
  test("a comment is a line with its id, file, lines, side and state, and its body under it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "list", "card:k1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "c1  src/a.ts:10-12 new  draft",
        "  why?",
        "c2  src/b.ts:4 old  draft",
        "  rename",
        "c3  src/a.ts:10-12 new  sent, outdated, reviewer high",
        "  first line",
        "  second line",
      ],
      err: [],
    });
    expect(callsOf(daemon, "review.list")).toEqual([{ target: "card:k1" }]);
  });

  test("a target with no comment says so", async () => {
    const daemon = fakeDaemon({ "review.list": () => ({ comments: [] }) });
    const run = await flightdeckd(["review", "list", "session:s1"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["session:s1: no comments"],
    });
  });

  test("--json keeps every key and prints null where the daemon sends none", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["review", "list", "card:k1", "--json"], daemon.port);
    const value = printed(run.out) as { comments: Array<Record<string, unknown>> };
    expect(run.code).toBe(0);
    expect(value.comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(value.comments[0]).toEqual({
      id: "c1",
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
      author: null,
      severity: null,
    });
    expect(value.comments[2]).toMatchObject({
      author: "reviewer",
      severity: "high",
      outdated: true,
    });
  });

  test("a target the daemon refuses is its text on stderr and exit 1", async () => {
    const daemon = fakeDaemon({
      "review.list": () => ({
        error: { code: "review_target_invalid", message: "the target is not a session" },
      }),
    });
    const run = await flightdeckd(["review", "list", "session:nope"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the target is not a session");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ "review.list": () => CLOSE });
    const run = await flightdeckd(["review", "list", "card:k1"], daemon.port);
    expect(run.code).toBe(2);
  });

  test("no daemon at all is exit 2", async () => {
    const run = await flightdeckd(["review", "list", "card:k1"], 1);
    expect(run.code).toBe(2);
  });

  test("text a session wrote cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "review.list": () => ({
        comments: [comment({ body: "\u001b[2Jwiped", path: "a\u001b[2J.ts" })],
      }),
    });
    const run = await flightdeckd(["review", "list", "card:k1"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });

  test("a body with accents and emoji is printed as it is", async () => {
    const daemon = fakeDaemon({
      "review.list": () => ({ comments: [comment({ body: "não é assim 🙂" })] }),
    });
    const run = await flightdeckd(["review", "list", "card:k1"], daemon.port);
    expect(run.out).toContain("  não é assim 🙂");
  });
});

describe("flightdeckd review arguments (issue #3619)", () => {
  test("list takes the target and --json and --host", () => {
    expect(parseArgs(["review", "list", "card:k1", "--json", "--host", "pi"])).toMatchObject({
      command: "review",
      action: "list",
      reviewTarget: "card:k1",
      json: true,
      host: "pi",
    });
  });

  test("list without a target is refused", () => {
    expect(() => parseArgs(["review", "list"])).toThrow("the target");
  });

  test("an unknown review action is refused", () => {
    expect(() => parseArgs(["review", "frobnicate"])).toThrow("invalid review action");
  });
});
