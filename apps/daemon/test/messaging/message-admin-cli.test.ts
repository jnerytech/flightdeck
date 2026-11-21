import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runMessageAdminCli } from "../../src/messaging/message-admin-cli.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { poll } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

/** A message as the daemon lists it: the protocol checks every one, so it must be whole. */
const message = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  fromSession: "s-coord",
  fromHost: "pi",
  toSession: "s-dev",
  toHost: "pi",
  text: "please review #12",
  status: "delivered",
  reason: null,
  createdAt: "2026-11-21T10:00:00Z",
  deliveredAt: "2026-11-21T10:00:01Z",
  teamId: null,
  kind: "session",
  ...over,
});

describe("flightdeckd message history (issue #3622)", () => {
  test("it asks the daemon with the filters it was given and prints one line per message", async () => {
    const daemon = fakeDaemon({
      "messages.list": () => ({
        messages: [message(), message({ id: "m2", status: "refused", reason: "loop paused" })],
      }),
    });
    const result = await runMessageAdminCli(
      { action: "history", team: "t1", days: 7, limit: 50, status: "refused" },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "messages.list")).toEqual([
      { type: "messages.list", payload: { team: "t1", days: 7, limit: 50, status: "refused" } },
    ]);
    expect(result.out).toEqual([
      "m1  2026-11-21T10:00:00Z  s-coord@pi to s-dev@pi  delivered  please review #12",
      "m2  2026-11-21T10:00:00Z  s-coord@pi to s-dev@pi  refused (loop paused)  please review #12",
    ]);
  });

  test("the session and peer host filters go to the daemon under its own names", async () => {
    const daemon = fakeDaemon({ "messages.list": () => ({ messages: [] }) });
    await runMessageAdminCli(
      { action: "history", session: "s-dev", withHost: "laptop" },
      config(daemon.port),
    );
    expect(daemon.calls.find((c) => c.type === "messages.list")?.payload).toEqual({
      session: "s-dev",
      host: "laptop",
    });
  });

  test("with no message it says so, and exits 0", async () => {
    const daemon = fakeDaemon({ "messages.list": () => ({ messages: [] }) });
    const result = await runMessageAdminCli({ action: "history" }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(text(result)).toBe("no messages");
  });

  test("--json prints the daemon's answer as one document", async () => {
    const daemon = fakeDaemon({ "messages.list": () => ({ messages: [message()] }) });
    const result = await runMessageAdminCli({ action: "history", json: true }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out.join("\n"))).toEqual({ messages: [message()] });
  });

  test("a refusal exits 1 with the daemon's own text", async () => {
    const daemon = fakeDaemon({
      "messages.list": () => ({ error: { code: "invalid", message: "days: too small" } }),
    });
    const result = await runMessageAdminCli({ action: "history", days: 0 }, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid: days: too small");
  });

  test("no daemon exits 2", async () => {
    const silent = fakeDaemon({});
    const result = await runMessageAdminCli({ action: "history" }, config(silent.port), {
      timeoutMs: 200,
    });
    expect(result.code).toBe(2);
    expect(text(result)).toContain("did not answer");
  });

  test("a message's text is one plain line: no markup, no terminal control, no token", async () => {
    const daemon = fakeDaemon({
      "messages.list": () => ({
        messages: [message({ text: `a\u001b[2Jb\nsecond <b>line</b> ${config(0).token}` })],
      }),
    });
    const result = await runMessageAdminCli({ action: "history" }, config(daemon.port));
    expect(result.out).toHaveLength(1);
    expect(result.out[0]).toContain("a [2Jb second <b>line</b> [token]");
    expect(result.out[0]).not.toContain("\u001b");
  });
});

describe("flightdeckd message rules (issue #3622)", () => {
  const rules = {
    policy: { allow: [{ id: "x", from: { persona: "a" }, to: { persona: "b" } }] },
    paused: ["s-a:s-b"],
  };

  test("it reads the policy in force and the pairs a loop paused", async () => {
    const daemon = fakeDaemon({ "messaging.rules.get": () => rules });
    const result = await runMessageAdminCli({ action: "rules" }, config(daemon.port));
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "messaging.rules.get")).toEqual([
      { type: "messaging.rules.get", payload: {} },
    ]);
    expect(result.out).toEqual([
      `policy: ${JSON.stringify(rules.policy)}`,
      "paused pairs: s-a:s-b",
    ]);
  });

  test("with no pair paused it says none", async () => {
    const daemon = fakeDaemon({ "messaging.rules.get": () => ({ ...rules, paused: [] }) });
    const result = await runMessageAdminCli({ action: "rules" }, config(daemon.port));
    expect(result.out.at(-1)).toBe("paused pairs: none");
  });

  test("--json prints the daemon's answer as one document", async () => {
    const daemon = fakeDaemon({ "messaging.rules.get": () => rules });
    const result = await runMessageAdminCli({ action: "rules", json: true }, config(daemon.port));
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out.join("\n"))).toEqual(rules);
  });

  test("a refusal exits 1", async () => {
    const daemon = fakeDaemon({
      "messaging.rules.get": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const result = await runMessageAdminCli({ action: "rules" }, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid: nope");
  });
});

const alert = {
  type: "messaging.alert",
  kind: "loop",
  from: "s-a",
  to: "s-b",
  message: "10 messages in 60 s",
  at: "2026-11-21T10:05:00Z",
};
const updated = { type: "messages.updated", message: message() };
const relay = {
  type: "messages.relay",
  message: {
    id: "m9",
    from: { id: "s-x", host: "laptop", name: null, persona: null, projectKey: null, teamId: null },
    toSession: "s-dev",
    toHost: "pi",
    text: "hello",
    createdAt: "2026-11-21T10:06:00Z",
    untrusted: false,
    kind: "session",
  },
};
const fired = {
  type: "idle.fired",
  watcher: "s-coord",
  session: "s-dev",
  at: "2026-11-21T10:07:00Z",
};

/** Runs `message watch` once the daemon has it, pushes the frames, and presses Ctrl-C when `lines` came. */
async function watched(
  daemon: ReturnType<typeof fakeDaemon>,
  frames: unknown[],
  options: { json?: boolean } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runMessageAdminCli(
    { action: "watch", ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "messages.watch"));
  for (const frame of frames) daemon.push(frame);
  await poll(() => lines.length >= frames.length);
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd message watch (issue #3622)", () => {
  test("it prints a line for each of the four frames and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "messages.watch": () => ({}) });
    const { result, lines } = await watched(daemon, [updated, relay, alert, fired]);
    expect(result.code).toBe(0);
    expect(lines).toEqual([
      "m1  2026-11-21T10:00:00Z  s-coord@pi to s-dev@pi  delivered  please review #12",
      "relay  m9  s-x@laptop to s-dev@pi  hello",
      "loop alert  s-a to s-b  10 messages in 60 s",
      "idle  s-dev  watched by s-coord",
    ]);
    expect(daemon.calls.filter((c) => c.type === "messages.watch")).toHaveLength(1);
  });

  test("--json prints one JSON line per frame, as the daemon sent it", async () => {
    const daemon = fakeDaemon({ "messages.watch": () => ({}) });
    const { lines } = await watched(daemon, [updated, alert, fired], { json: true });
    expect(lines.map((l) => JSON.parse(l))).toEqual([updated, alert, fired]);
  });

  test("a refused watch exits 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({
      "messages.watch": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const result = await runMessageAdminCli({ action: "watch" }, config(daemon.port), {
      timeoutMs: 2000,
      signal: new AbortController().signal,
      write: () => undefined,
    });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid: nope");
  });

  test("a message's text cannot drive the terminal or leak the token", async () => {
    const daemon = fakeDaemon({ "messages.watch": () => ({}) });
    const { lines } = await watched(daemon, [
      { type: "messages.updated", message: message({ text: `a\u001b[2Jb ${config(0).token}` }) },
    ]);
    expect(lines[0]).toEndWith("a [2Jb [token]");
  });
});

describe("the arguments of message history, watch and rules (issue #3622)", () => {
  test("history takes its filters and --json", () => {
    expect(parsed(["message", "history"])).toMatchObject({ command: "message", action: "history" });
    expect(
      parsed([
        "message",
        "history",
        "--team",
        "t1",
        "--session",
        "s-dev",
        "--with-host",
        "laptop",
        "--status",
        "queued",
        "--days",
        "7",
        "--limit",
        "50",
        "--json",
        "--host",
        "pi",
      ]),
    ).toMatchObject({
      command: "message",
      action: "history",
      messageTeam: "t1",
      session: "s-dev",
      withHost: "laptop",
      messageStatus: "queued",
      days: 7,
      limit: 50,
      json: true,
      host: "pi",
    });
  });

  test("watch and rules take --json and --host", () => {
    expect(parsed(["message", "watch", "--json"])).toMatchObject({ action: "watch", json: true });
    expect(parsed(["message", "rules", "--host", "pi"])).toMatchObject({
      action: "rules",
      host: "pi",
    });
  });

  test("a bad status, days or limit is refused", () => {
    expect(parsed(["message", "history", "--status", "lost"])).toMatchObject({
      refusedWith: expect.stringContaining("--status"),
    });
    expect(parsed(["message", "history", "--days", "0"])).toMatchObject({
      refusedWith: expect.stringContaining("--days"),
    });
    expect(parsed(["message", "history", "--limit", "2000"])).toMatchObject({
      refusedWith: expect.stringContaining("--limit"),
    });
  });

  test("a filter belongs to history only, and --json and --host to the three new verbs", () => {
    for (const [argv, flag] of [
      [["message", "watch", "--team", "t1"], "--team"],
      [["message", "rules", "--days", "3"], "--days"],
      [["message", "rules", "--status", "queued"], "--status"],
      [["message", "watch", "--limit", "5"], "--limit"],
      [["message", "rules", "--with-host", "laptop"], "--with-host"],
    ] as const)
      expect(parsed([...argv])).toMatchObject({
        refusedWith: expect.stringContaining(
          `${flag}: this flag only applies to flightdeckd message history`,
        ),
      });
    expect(parsed(["message", "send", "s-dev", "hi", "--json"])).toMatchObject({
      refusedWith: expect.stringContaining(
        "--json: this flag only applies to flightdeckd message history, watch and rules",
      ),
    });
    expect(parsed(["message", "list", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining(
        "--host: this flag only applies to flightdeckd message history, watch and rules",
      ),
    });
  });

  test("the verbs that exist keep their arguments", () => {
    expect(parsed(["message", "list"])).toMatchObject({ command: "message", action: "list" });
    expect(parsed(["message", "read", "s-dev", "--last", "3"])).toMatchObject({
      action: "read",
      session: "s-dev",
      last: 3,
    });
  });
});
