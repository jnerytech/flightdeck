import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import {
  type CardCliArgs,
  type CardCliResult,
  isLoopbackHost,
  runCardCli,
} from "../src/card-cli.ts";

setDefaultTimeout(20_000);

const TOKEN = "card-cli-token-0123456789abcdef";

/** What the daemon says for a command: data, or `{ error }` for a refusal. */
type Answer = unknown | { error: { code: string; message: string } };
type Handlers = Record<string, (payload: Record<string, unknown>) => Answer | Promise<Answer>>;

const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** A daemon of this test: `hello` checks the token, every other command is a handler or silent. */
function fakeDaemon(handlers: Handlers, token = TOKEN) {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws only", { status: 400 })),
    websocket: {
      async message(ws, raw) {
        const { id, type, payload } = JSON.parse(String(raw)) as {
          id: string;
          type: string;
          payload: Record<string, unknown>;
        };
        calls.push({ type, payload });
        const answer =
          type === "hello"
            ? payload.token === token
              ? {}
              : { error: { code: "unauthorized", message: `bad token ${String(payload.token)}` } }
            : await handlers[type]?.(payload);
        if (answer === undefined && type !== "hello") return; // a daemon that never answers
        const error = (answer as { error?: unknown } | undefined)?.error;
        ws.send(
          JSON.stringify({
            type: "ack",
            id,
            ...(error ? { ok: false, error } : { ok: true, data: answer }),
          }),
        );
      },
    },
  });
  stops.push(() => server.stop(true));
  return { port: server.port as number, calls };
}

const config = (port: number, bind = "127.0.0.1") => ({ bind, port, token: TOKEN });

const project = (id: string, name: string) => ({
  id,
  name,
  path: `/w/${name}`,
  baseBranch: "main",
});
const card = (id: string, over: Partial<Card> = {}): Card =>
  ({
    id,
    projectId: "p1",
    title: `card ${id}`,
    description: "",
    column: "backlog",
    queued: false,
    queueReason: null,
    quotaUntil: null,
    branch: null,
    prUrl: null,
    notice: null,
    waitingOn: [],
    ...over,
  }) as Card;

/** Two projects, the first with cards in two columns. */
const HOST: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web")],
    maxParallelRuns: 2,
  }),
  "board.get": ({ projectId }) =>
    projectId === "p1"
      ? {
          project: project("p1", "api"),
          columns: [
            { column: "backlog", cards: [card("c1", { title: "Fix login" })] },
            {
              column: "in_progress",
              cards: [
                card("c2", {
                  title: "Slow build",
                  column: "in_progress",
                  queued: true,
                  queueReason: "slot",
                }),
              ],
            },
          ],
        }
      : {
          project: project("p2", "web"),
          columns: [
            { column: "backlog", cards: [card("c3", { projectId: "p2", title: "Dark mode" })] },
          ],
        },
};

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
