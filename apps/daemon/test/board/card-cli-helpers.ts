/** A daemon of the tests of `flightdeckd card`: it speaks the protocol and answers what the test says. */
import type { Card } from "@flightdeck/protocol";

export const TOKEN = "card-cli-token-0123456789abcdef";

/** What the daemon says for a command: data, or `{ error }` for a refusal. */
type Answer = unknown | { error: { code: string; message: string } };
/** What a handler can do besides answer: push a frame of its own to the client that asked (a stream). */
interface Push {
  push(frame: unknown): void;
}
export type Handlers = Record<
  string,
  (payload: Record<string, unknown>, ctx: Push) => Answer | Promise<Answer>
>;

export const stops: Array<() => unknown> = [];
/** `afterEach(stopAll)` in every test file: a module is loaded once, so it cannot register this for them all. */
export async function stopAll(): Promise<void> {
  for (const stop of stops.splice(0)) await stop();
}

/** A daemon of this test: `hello` checks the token, every other command is a handler or silent. */
/** A handler that answers with this closes the connection instead (a daemon that dies mid-command). */
export const CLOSE = Symbol("close");
/** A handler that answers with this closes with 4401, as a daemon does when the token is revoked mid-command. */
export const REVOKE = Symbol("revoke");

export function fakeDaemon(
  handlers: Handlers,
  token = TOKEN,
  options: { helloDelayMs?: number } = {},
) {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let closes = 0;
  const sockets = new Set<{ send(data: string): void; close(): void }>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws only", { status: 400 })),
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
        closes += 1;
      },
      async message(ws, raw) {
        const { id, type, payload } = JSON.parse(String(raw)) as {
          id: string;
          type: string;
          payload: Record<string, unknown>;
        };
        calls.push({ type, payload });
        // timing: a daemon that is slow to say hello is the case under test
        if (type === "hello" && options.helloDelayMs) await Bun.sleep(options.helloDelayMs);
        const answer =
          type === "hello"
            ? payload.token === token
              ? {}
              : { error: { code: "unauthorized", message: `bad token ${String(payload.token)}` } }
            : await handlers[type]?.(payload, { push: (frame) => ws.send(JSON.stringify(frame)) });
        if (answer === CLOSE) return void ws.close();
        if (answer === REVOKE) return void ws.close(4401);
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
  return {
    port: server.port as number,
    calls,
    closed: () => closes,
    /** A frame to every client that is connected: the daemon telling them something unasked. */
    push: (frame: unknown) => {
      for (const ws of sockets) ws.send(JSON.stringify(frame));
    },
    /** The daemon goes away under its clients. */
    dropAll: () => {
      for (const ws of sockets) ws.close();
    },
  };
}

export const config = (port: number, bind = "127.0.0.1") => ({ bind, port, token: TOKEN });

export const project = (id: string, name: string) => ({
  id,
  name,
  path: `/w/${name}`,
  baseBranch: "main",
});
export const card = (id: string, over: Partial<Card> = {}): Card =>
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
export const HOST: Handlers = {
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
