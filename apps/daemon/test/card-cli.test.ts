import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import {
  type CardCliArgs,
  type CardCliResult,
  isLoopbackHost,
  runCardCli,
} from "../src/card-cli.ts";
import {
  CLOSE,
  card,
  config,
  fakeDaemon,
  type Handlers,
  HOST,
  project,
  stopAll,
  stops,
  TOKEN,
} from "./card-cli-helpers.ts";
import { poll } from "./helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

async function run(args: CardCliArgs, daemon: { port: number }, bind?: string, timeoutMs?: number) {
  return runCardCli(args, config(daemon.port, bind), timeoutMs ? { timeoutMs } : {});
}
const text = (r: CardCliResult) => [...r.out, ...r.err].join("\n");

describe("card list (issue #1507)", () => {
  test("lists the cards of every project, one line each, with the project, the column and why a queued one waits", async () => {
    const daemon = fakeDaemon(HOST);
    const result = await run({ action: "list" }, daemon);
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out).toEqual([
      "api  c1  backlog  Fix login",
      "api  c2  in_progress  Slow build (waiting for a free slot)",
      "web  c3  backlog  Dark mode",
    ]);
  });

  test("--project asks for that project's board only, by name or id", async () => {
    const byName = fakeDaemon(HOST);
    const named = await run({ action: "list", project: "WEB" }, byName);
    expect(named.out).toEqual(["web  c3  backlog  Dark mode"]);
    expect(
      byName.calls.filter((c) => c.type === "board.get").map((c) => c.payload.projectId),
    ).toEqual(["p2"]);
    const byId = fakeDaemon(HOST);
    expect((await run({ action: "list", project: "p1" }, byId)).out).toHaveLength(2);
  });

  test("--json prints the cards for a script", async () => {
    const result = await run({ action: "list", json: true }, fakeDaemon(HOST));
    expect(result.code).toBe(0);
    const cards = JSON.parse(result.out.join("\n")) as Array<Record<string, unknown>>;
    expect(cards.map((c) => [c.project, c.id, c.column, c.title, c.queued, c.queueReason])).toEqual(
      [
        ["api", "c1", "backlog", "Fix login", false, null],
        ["api", "c2", "in_progress", "Slow build", true, "slot"],
        ["web", "c3", "backlog", "Dark mode", false, null],
      ],
    );
  });

  test("an unknown project is refused with the names there are, and nothing is listed", async () => {
    const result = await run({ action: "list", project: "mobile" }, fakeDaemon(HOST));
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(text(result)).toContain('no project named "mobile"');
    expect(text(result)).toContain("api");
    expect(text(result)).toContain("web");
  });
});

describe("card show (issue #1507)", () => {
  const shown = card("c2", {
    title: "Slow build",
    column: "in_progress",
    queued: true,
    queueReason: "quota",
    quotaUntil: "2026-11-09T18:00:00.000Z",
    branch: "card/slow-build",
    prUrl: "https://example.test/pr/7",
    notice: "setup failed",
  });
  const handlers: Handlers = {
    "card.get": ({ cardId }) =>
      cardId === "c2" ? shown : { error: { code: "not_found", message: "no such card" } },
  };

  test("says the title, the column, the branch, the PR, why it waits and the last notice", async () => {
    const result = await run({ action: "show", id: "c2" }, fakeDaemon(handlers));
    expect(result.code).toBe(0);
    const out = result.out.join("\n");
    for (const part of [
      "c2",
      "Slow build",
      "in_progress",
      "card/slow-build",
      "https://example.test/pr/7",
      "waiting for the plan quota to reset (until 2026-11-09T18:00:00.000Z)",
      "setup failed",
    ])
      expect(out).toContain(part);
  });

  test("--json is the card as the daemon has it", async () => {
    const result = await run({ action: "show", id: "c2", json: true }, fakeDaemon(handlers));
    expect(JSON.parse(result.out.join("\n"))).toMatchObject({
      id: "c2",
      branch: "card/slow-build",
    });
  });

  test("a refusal of the daemon is exit 1 with its code and reason", async () => {
    const result = await run({ action: "show", id: "nope" }, fakeDaemon(handlers));
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err.join("\n")).toContain("not_found: no such card");
  });
});

describe("card new (issue #1507)", () => {
  const handlers: Handlers = {
    ...HOST,
    "card.create": ({ projectId, title, description }) =>
      card("c9", {
        projectId: String(projectId),
        title: String(title),
        description: String(description),
      }),
  };

  test("creates the card in the named project and says its id", async () => {
    const daemon = fakeDaemon(handlers);
    const result = await run(
      { action: "new", title: "Add dark mode", description: "see #12", project: "web" },
      daemon,
    );
    expect(result).toEqual({ code: 0, out: ["created c9  Add dark mode"], err: [] });
    expect(daemon.calls.find((c) => c.type === "card.create")?.payload).toEqual({
      projectId: "p2",
      title: "Add dark mode",
      description: "see #12",
    });
  });

  test("without --project, a host with one project uses it; with several, it asks which and creates nothing", async () => {
    const one = fakeDaemon({
      ...handlers,
      "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 1 }),
    });
    expect((await run({ action: "new", title: "T" }, one)).code).toBe(0);
    expect(one.calls.find((c) => c.type === "card.create")?.payload.projectId).toBe("p1");

    const many = fakeDaemon(handlers);
    const asked = await run({ action: "new", title: "T" }, many);
    expect(asked.code).toBe(1);
    expect(text(asked)).toContain("--project");
    expect(text(asked)).toContain("api, web");
    expect(many.calls.some((c) => c.type === "card.create")).toBe(false);
  });

  test("two projects with the same name are ambiguous, and the id picks one", async () => {
    const twins: Handlers = {
      ...handlers,
      "project.list": () => ({
        projects: [project("p1", "app"), project("p2", "app")],
        maxParallelRuns: 1,
      }),
    };
    const daemon = fakeDaemon(twins);
    const ambiguous = await run({ action: "new", title: "T", project: "app" }, daemon);
    expect(ambiguous.code).toBe(1);
    expect(text(ambiguous)).toContain("p1");
    expect(text(ambiguous)).toContain("p2");
    expect((await run({ action: "new", title: "T", project: "p2" }, daemon)).code).toBe(0);
  });

  test("--json prints the new card", async () => {
    const result = await run(
      { action: "new", title: "T", project: "api", json: true },
      fakeDaemon(handlers),
    );
    expect(JSON.parse(result.out.join("\n"))).toMatchObject({ id: "c9", title: "T" });
  });
});

describe("card start (issue #1507)", () => {
  const handlers = (started: Partial<Card>): Handlers => ({
    "card.start": ({ cardId, workflow }) =>
      cardId === "held"
        ? { error: { code: "held", message: "the host is paused" } }
        : card(String(cardId), {
            column: "in_progress",
            ...started,
            ...(workflow ? { title: `via ${String(workflow)}` } : {}),
          }),
  });

  test("a card that runs is started", async () => {
    const daemon = fakeDaemon(handlers({}));
    const result = await run({ action: "start", id: "c1", workflow: "review" }, daemon);
    expect(result).toEqual({ code: 0, out: ["started c1  via review"], err: [] });
    expect(daemon.calls.find((c) => c.type === "card.start")?.payload).toEqual({
      cardId: "c1",
      workflow: "review",
    });
  });

  test("a card that must wait says why and still exits 0", async () => {
    for (const [reason, said] of [
      ["slot", "waiting for a free slot"],
      ["memory", "waiting for the host's memory"],
      ["budget", "waiting for the budget"],
      ["paused", "the host is paused"],
    ] as const) {
      const result = await run(
        { action: "start", id: "c1" },
        fakeDaemon(handlers({ queued: true, queueReason: reason })),
      );
      expect(result.code).toBe(0);
      expect(result.out).toEqual([`queued c1  card c1: ${said}`]);
    }
    const blocked = await run(
      { action: "start", id: "c1" },
      fakeDaemon(handlers({ waitingOn: ["c0"] })),
    );
    expect(blocked.code).toBe(0);
    expect(blocked.out.join("\n")).toContain("waiting for 1 card to be done first");
  });

  test("a refusal is exit 1 with the daemon's code and reason", async () => {
    const result = await run({ action: "start", id: "held" }, fakeDaemon(handlers({})));
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("held: the host is paused");
  });

  test("--json prints the card, queued or not", async () => {
    const result = await run(
      { action: "start", id: "c1", json: true },
      fakeDaemon(handlers({ queued: true, queueReason: "slot" })),
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out.join("\n"))).toMatchObject({
      id: "c1",
      queued: true,
      queueReason: "slot",
    });
  });
});

describe("card: the daemon is not there, or does not answer (issue #1507)", () => {
  test("nothing listens: exit 2, in words, without the token", async () => {
    const gone = fakeDaemon(HOST);
    await Promise.all(stops.splice(0).map(async (stop) => stop()));
    const result = await runCardCli({ action: "list" }, config(gone.port));
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(text(result)).toContain("could not reach the daemon");
    expect(text(result)).not.toContain(TOKEN);
  });

  test("a daemon that never answers: exit 2 after the time given", async () => {
    const silent = fakeDaemon({});
    const started = Date.now();
    const result = await run({ action: "list" }, silent, undefined, 300);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("did not answer");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("card: the token and the address (issue #1507)", () => {
  test("the token goes to the daemon in hello, and never to the output, even when the daemon echoes it", async () => {
    const echoing = fakeDaemon({
      "project.list": () => ({ error: { code: "boom", message: `failed for ${TOKEN}` } }),
    });
    const refused = await run({ action: "list" }, echoing);
    expect(refused.code).toBe(1);
    expect(echoing.calls[0]).toEqual({
      type: "hello",
      payload: expect.objectContaining({ token: TOKEN }),
    });
    expect(text(refused)).toContain("boom");
    expect(text(refused)).not.toContain(TOKEN);

    // A wrong token: the daemon's refusal says it, and our output does not repeat any token.
    const strict = fakeDaemon(HOST, "another-token-0123456789abcdef");
    const denied = await run({ action: "list" }, strict);
    expect(denied.code).toBe(1);
    expect(text(denied)).toContain("unauthorized");
    expect(text(denied)).not.toContain(TOKEN);
  });

  test("a daemon that is not on the loopback is refused before any connection", async () => {
    const daemon = fakeDaemon(HOST);
    for (const bind of ["192.168.1.20", "10.0.0.5", "example.test", "2001:db8::1"]) {
      const result = await run({ action: "list" }, daemon, bind);
      expect(result.code).toBe(1);
      expect(text(result)).toContain("loopback");
      expect(text(result)).not.toContain(TOKEN);
    }
    expect(daemon.calls).toEqual([]);
  });

  test("the loopback in its usual spellings, and a daemon that listens everywhere, are the local one", async () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "localhost", "LocalHost", "::1", "[::1]"])
      expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["192.168.1.20", "0.0.0.0", "1270.0.0.1", "127.0.0.1.example.test", ""])
      expect(isLoopbackHost(host)).toBe(false);
    // 0.0.0.0 and :: are what a daemon listens on; the CLI reaches it on 127.0.0.1 (daemonUrl).
    const daemon = fakeDaemon(HOST);
    expect((await run({ action: "list" }, daemon, "0.0.0.0")).code).toBe(0);
  });
});

describe("card: what the daemon's text can do to the terminal, and to the address (issue #1507)", () => {
  const nasty = "\u001b[31mred\u001b[0m\r\nfake: a forged line\u009b2J\u007f";
  const handlers: Handlers = {
    ...HOST,
    "card.get": () => card("c1", { title: nasty, notice: nasty, branch: nasty }),
    "card.start": () => card("c1", { title: nasty }),
    "card.create": () => card("c9", { title: nasty }),
    "board.get": () => ({
      project: project("p1", "api"),
      columns: [{ column: "backlog", cards: [card("c1", { title: nasty })] }],
    }),
  };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point of the test is these characters
  const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

  test("no control character of a card's text reaches the terminal, in text or in --json", async () => {
    const daemon = fakeDaemon(handlers);
    for (const args of [
      { action: "list", project: "api" },
      { action: "list", project: "api", json: true },
      { action: "show", id: "c1" },
      { action: "show", id: "c1", json: true },
      { action: "start", id: "c1" },
      { action: "new", title: "T", project: "api" },
    ] satisfies CardCliArgs[]) {
      const result = await run(args, daemon);
      expect(result.code).toBe(0);
      expect(result.out.length).toBeGreaterThan(0);
      for (const line of result.out) expect(CONTROL.test(line)).toBe(false);
      // The text is still there, and its line break did not start a line of its own.
      expect(result.out.join("\n")).toContain("red");
      expect(result.out.some((line) => line.startsWith("fake:"))).toBe(false);
    }
  });

  test("an error text of the daemon is cleaned the same way", async () => {
    const daemon = fakeDaemon({
      "project.list": () => ({ error: { code: "boom", message: nasty } }),
    });
    const result = await run({ action: "list" }, daemon);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("boom");
    for (const line of result.err) expect(CONTROL.test(line)).toBe(false);
    expect(result.err).toHaveLength(1);
  });

  test("a bind that only looks like a loopback (a query, a user, a path) is refused, nothing is sent", async () => {
    const daemon = fakeDaemon(HOST);
    for (const bind of ["127.0.0.1?@evil.test", "127.0.0.1/x?", "user@127.0.0.1", "127.0.0.1#"]) {
      const result = await run({ action: "list" }, daemon, bind);
      expect(result.code).toBe(1);
      expect(text(result)).toContain("loopback");
    }
    expect(daemon.calls).toEqual([]);
  });

  test("a write that got no answer says its result is unknown, so nobody retries blindly", async () => {
    const silent = fakeDaemon({
      ...HOST,
      "card.create": undefined as never,
      "card.start": undefined as never,
    });
    const created = await run(
      { action: "new", title: "T", project: "api" },
      silent,
      undefined,
      300,
    );
    expect(created.code).toBe(2);
    expect(text(created)).toContain("may or may not have been created");
    const started = await run({ action: "start", id: "c1" }, silent, undefined, 300);
    expect(started.code).toBe(2);
    expect(text(started)).toContain("may or may not have been started");
    // A read has nothing to be unsure of.
    const listed = await run({ action: "list" }, fakeDaemon({}), undefined, 300);
    expect(text(listed)).not.toContain("may or may not");
  });
});

describe("card: a command that gave up does not write later, and says what it knows (issue #1507)", () => {
  test("the time ran out while the daemon was still saying hello: nothing is written afterwards", async () => {
    const slow = fakeDaemon({ ...HOST, "card.create": () => card("c9") }, TOKEN, {
      helloDelayMs: 600,
    });
    const result = await run({ action: "new", title: "T", project: "api" }, slow, undefined, 200);
    expect(result.code).toBe(2);
    // Nothing was sent, so there is nothing to be unsure about.
    expect(text(result)).toContain("did not answer");
    expect(text(result)).not.toContain("may or may not");
    // timing: the late hello answer is what would have let the write go out
    await Bun.sleep(900);
    expect(slow.calls.map((call) => call.type)).toEqual(["hello"]);
  });

  test("a daemon that drops the connection after the write was sent leaves the result unknown, not 'is it running'", async () => {
    const dying = fakeDaemon({ ...HOST, "card.create": () => CLOSE, "card.start": () => CLOSE });
    const created = await run({ action: "new", title: "T", project: "api" }, dying);
    expect(created.code).toBe(2);
    expect(text(created)).toContain("closed the connection");
    expect(text(created)).toContain("may or may not have been created");
    const started = await run({ action: "start", id: "c1" }, dying);
    expect(text(started)).toContain("may or may not have been started");
    // A read that is cut has nothing to be unsure of, and still means the daemon is not there.
    const dyingRead = fakeDaemon({ "project.list": () => CLOSE });
    const listed = await run({ action: "list" }, dyingRead);
    expect(listed.code).toBe(2);
    expect(text(listed)).not.toContain("may or may not");
  });

  test("a hello the daemon refuses closes the socket it opened", async () => {
    const strict = fakeDaemon(HOST, "another-token-0123456789abcdef");
    expect((await run({ action: "list" }, strict)).code).toBe(1);
    expect(await poll(() => strict.closed() === 1, 1000)).toBe(true);
  });
});

describe("card: what is shown is only what the daemon said, cleaned (issue #1507)", () => {
  const onlyTitle = (title: string): Handlers => ({
    ...HOST,
    "card.get": () => card("c1", { title }),
    "board.get": () => ({
      project: project("p1", "api"),
      columns: [{ column: "backlog", cards: [card("c1", { title })] }],
    }),
  });

  test("the token is not in a successful output either, even in a card's own text", async () => {
    const daemon = fakeDaemon(onlyTitle(`leaks ${TOKEN} here`));
    for (const args of [
      { action: "show", id: "c1" },
      { action: "show", id: "c1", json: true },
      { action: "list", project: "api" },
    ] satisfies CardCliArgs[]) {
      const result = await run(args, daemon);
      expect(result.code).toBe(0);
      expect(text(result)).toContain("leaks");
      expect(text(result)).not.toContain(TOKEN);
    }
  });

  test("a bidi override, a line separator and a zero-width character cannot reorder or hide text", async () => {
    // The characters are named by code point: a literal one in the source is what a reader cannot see.
    const hidden = [0x202e, 0x2066, 0x2028, 0x200b, 0xfeff].map((code) =>
      String.fromCodePoint(code),
    );
    const daemon = fakeDaemon(
      onlyTitle(["a", "b", "c", "d", "e", "f"].map((c, n) => c + (hidden[n] ?? "")).join("")),
    );
    const result = await run({ action: "show", id: "c1" }, daemon);
    expect(result.out[0]).toBe("c1  a b c d e f");
  });

  test("a reason for waiting this CLI does not know is shown as it came, not as 'undefined'", async () => {
    const daemon = fakeDaemon({
      ...HOST,
      "card.start": () => card("c1", { queued: true, queueReason: "maintenance" as never }),
    });
    const result = await run({ action: "start", id: "c1" }, daemon);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(["queued c1  card c1: waiting (maintenance)"]);
  });

  test("a bind that is not an address at all is a refusal, not a crash", async () => {
    const result = await run({ action: "list" }, fakeDaemon(HOST), "[::1]");
    expect(result.code).toBe(1);
    expect(text(result)).toContain("not a valid address");
  });
});
