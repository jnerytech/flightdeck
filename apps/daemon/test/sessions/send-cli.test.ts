import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SESSIONS = {
  sessions: [
    { id: "s1", name: "fd-qa" },
    { id: "s2", name: "twin" },
    { id: "s3", name: "twin" },
    { id: "s4", name: null },
  ],
};
const OPEN: Handlers = {
  "session.list": () => SESSIONS,
  "session.send": () => ({ queued: false }),
};

const sent = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "session.send").map((c) => c.payload);

describe("flightdeckd send (issue #3425)", () => {
  test("a session by name gets the text as typed, and one JSON object says it was queued or not", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["send", "fd-qa", "run the suite", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ session: "s1", queued: false });
    expect(sent(daemon)).toEqual([{ sessionId: "s1", text: "run the suite" }]);
  });

  test("a session by id works too, and the text line says where it went", async () => {
    const daemon = fakeDaemon({ ...OPEN, "session.send": () => ({ queued: true }) });
    const run = await flightdeckd(["send", "s4", "hello"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual(["queued for s4"]);
    expect(sent(daemon)).toEqual([{ sessionId: "s4", text: "hello" }]);
  });

  test("a session that takes the text at once says sent", async () => {
    const run = await flightdeckd(["send", "fd-qa", "hello"], fakeDaemon(OPEN).port);
    expect(run.out).toEqual(["sent to s1"]);
  });

  test("the text goes through whole: spaces, quotes and a new line", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["send", "s1", '  say "hi"\nthen stop  '], daemon.port);
    expect(sent(daemon)).toEqual([{ sessionId: "s1", text: '  say "hi"\nthen stop  ' }]);
  });

  test("a session that does not exist or a name two sessions share is refused, and nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const none = await flightdeckd(["send", "nobody", "x"], daemon.port);
    expect(none.code).toBe(1);
    expect(none.err.join("\n")).toContain("no such session: nobody");
    const twin = await flightdeckd(["send", "twin", "x"], daemon.port);
    expect(twin.code).toBe(1);
    expect(twin.err.join("\n")).toContain("2 sessions are named twin");
    expect(sent(daemon)).toEqual([]);
  });

  test("an ended session: the daemon's refusal is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "session.send": () => ({
        error: { code: "invalid_state", message: "the session has ended", reason: "session_ended" },
      }),
    });
    const run = await flightdeckd(["send", "s1", "x"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("the session has ended");
  });

  test("a daemon that dies before it answers: exit 2, and the text may or may not have gone in", async () => {
    const daemon = fakeDaemon({ ...OPEN, "session.send": () => CLOSE });
    const run = await flightdeckd(["send", "s1", "x"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });

  test("no daemon at the address of the config: exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["send", "s1", "x"], port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });

  test("--token is refused with exit 1 and nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["send", "s1", "x", "--token", "t"], daemon.port);
    expect(run.code).toBe(1);
    expect(daemon.calls).toEqual([]);
  });

  test("the session and the text are both required", () => {
    expect(() => parseArgs(["send"])).toThrow("missing the session");
    expect(() => parseArgs(["send", "s1"])).toThrow("missing the text");
    expect(parseArgs(["send", "s1", "hi"])).toMatchObject({
      command: "send",
      session: "s1",
      text: "hi",
    });
  });
});
