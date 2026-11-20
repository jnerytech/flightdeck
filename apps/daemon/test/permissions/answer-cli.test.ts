import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const HOLD_REQUIRED = {
  error: {
    code: "invalid_state",
    message: "a high-risk request is allowed only with the hold of the Approve (held: true)",
    reason: "hold_required",
  },
};
const CLOSED = {
  error: {
    code: "not_found",
    message: "pedido de permissão r9 não está aberto",
    reason: "permission_request_closed",
  },
};

/** A daemon with `r1` (low risk) and `r2` (high risk) open: the second needs the hold, as the real one does. */
const OPEN: Handlers = {
  "permission.respond": ({ requestId, decision, held }) => {
    if (requestId === "r1") return {};
    if (requestId === "r2" && decision === "allow" && held !== true) return HOLD_REQUIRED;
    if (requestId === "r2") return {};
    return CLOSED;
  },
};

const answers = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "permission.respond").map((c) => c.payload);

describe("flightdeckd approve and deny (issue #3425)", () => {
  test("approve of a low-risk request sends one allow, prints one JSON object and exits 0", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["approve", "r1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ id: "r1", decision: "allow" });
    expect(answers(daemon)).toEqual([{ requestId: "r1", decision: "allow" }]);
  });

  test("without --json the answer is one line", async () => {
    const approved = await flightdeckd(["approve", "r1"], fakeDaemon(OPEN).port);
    expect(approved.code).toBe(0);
    expect(approved.out).toEqual(["allowed r1"]);
    const denied = await flightdeckd(["deny", "r1"], fakeDaemon(OPEN).port);
    expect(denied.code).toBe(0);
    expect(denied.out).toEqual(["denied r1"]);
  });

  test("deny with --message sends the message to Claude", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["deny", "r1", "--message", "too broad", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      id: "r1",
      decision: "deny",
      message: "too broad",
    });
    expect(answers(daemon)).toEqual([{ requestId: "r1", decision: "deny", message: "too broad" }]);
  });

  test("approve with --message sends it with the allow", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(["approve", "r1", "--message", "ok, once"], daemon.port);
    expect(answers(daemon)).toEqual([{ requestId: "r1", decision: "allow", message: "ok, once" }]);
  });

  test("a high-risk approve without --hold is refused: exit 1, the daemon's reason and what to do", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["approve", "r2"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    const text = run.err.join("\n");
    expect(text).toContain("high-risk");
    expect(text).toContain("--hold");
    expect(answers(daemon)).toEqual([{ requestId: "r2", decision: "allow" }]);
  });

  test("approve --hold sends held: true, and the answer says it was asserted", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["approve", "r2", "--hold", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ id: "r2", decision: "allow", held: true });
    expect(answers(daemon)).toEqual([{ requestId: "r2", decision: "allow", held: true }]);
  });

  test("a deny of a high-risk request needs no hold", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["deny", "r2"], daemon.port);
    expect(run.code).toBe(0);
    expect(answers(daemon)).toEqual([{ requestId: "r2", decision: "deny" }]);
  });

  test("a request that is not open is refused with exit 1: no such request", async () => {
    const run = await flightdeckd(["approve", "r9"], fakeDaemon(OPEN).port);
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("no such request: r9");
  });

  test("any other refusal of the daemon is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      "permission.respond": () => ({ error: { code: "invalid_input", message: "bad answer" } }),
    });
    const run = await flightdeckd(["deny", "r1"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("bad answer");
  });

  test("a daemon that dies before it answers: exit 2, and the answer may or may not have been recorded", async () => {
    const daemon = fakeDaemon({ "permission.respond": () => CLOSE });
    const run = await flightdeckd(["approve", "r1"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });

  test("no daemon at the address of the config: exit 2 for approve and deny", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    for (const verb of ["approve", "deny"]) {
      const run = await flightdeckd([verb, "r1"], port);
      expect(run.code).toBe(2);
      expect(run.err.join("\n")).toContain("could not reach the daemon");
    }
  });

  test("--token is refused with exit 1 and nothing is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["approve", "r1", "--token", "x"], daemon.port);
    expect(run.code).toBe(1);
    expect(daemon.calls).toEqual([]);
  });

  test("the request is required, --hold belongs to approve, and --message to the two answers", () => {
    expect(() => parseArgs(["approve"])).toThrow("missing the request");
    expect(() => parseArgs(["deny"])).toThrow("missing the request");
    expect(() => parseArgs(["deny", "r1", "--hold"])).toThrow(
      "only applies to flightdeckd approve",
    );
    expect(() => parseArgs(["requests", "--hold"])).toThrow("only applies to flightdeckd approve");
    expect(() => parseArgs(["requests", "--message", "x"])).toThrow("approve and deny");
    expect(parseArgs(["approve", "r1", "--hold", "--message", "go"])).toMatchObject({
      command: "approve",
      requestId: "r1",
      hold: true,
      answerMessage: "go",
    });
  });
});
