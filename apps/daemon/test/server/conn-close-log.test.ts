import { afterEach, describe, expect, test } from "bun:test";
import { CLOSE_HEARTBEAT } from "@flightdeck/protocol";
import { type CloseFacts, closeLine } from "../../src/server/close-log.ts";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager, poll } from "../support/helpers.ts";

const TOKEN = "close-log-token-0123456789ab";
const servers: RunningServer[] = [];
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const s of servers.splice(0)) await s.stop();
});

const facts = (over: Partial<CloseFacts> = {}): CloseFacts => ({
  id: 3,
  client: "flightdeck-app",
  code: 1001,
  reason: "going away",
  byDaemon: null,
  upMs: 272_400,
  silentMs: 3_100,
  pongAgoMs: 2_900,
  ...over,
});

describe("conn-close-log: the line the daemon writes when a connection closes (issue #1532)", () => {
  test("a close by the peer, a heartbeat timeout and a connection that never said hello", () => {
    expect(closeLine(facts(), TOKEN)).toBe(
      'connection #3 closed: client "flightdeck-app", code 1001 "going away", by the peer, up 272 s, last frame 3 s ago, last pong 3 s ago',
    );
    expect(
      closeLine(
        facts({
          code: CLOSE_HEARTBEAT,
          reason: "heartbeat timeout",
          byDaemon: "heartbeat",
          silentMs: 61_000,
          pongAgoMs: null,
        }),
        TOKEN,
      ),
    ).toBe(
      'connection #3 closed: client "flightdeck-app", code 4408 "heartbeat timeout", by the daemon (heartbeat), up 272 s, last frame 61 s ago, no pong yet',
    );
    expect(
      closeLine(
        facts({
          client: null,
          code: 4401,
          reason: "unauthorized",
          byDaemon: "unauthorized",
          upMs: 40,
        }),
        TOKEN,
      ),
    ).toContain("client unknown, code 4401");
  });

  test("the token, a control character and a long text of the peer never reach the line", () => {
    const line = closeLine(
      facts({
        client: `app-${TOKEN}`,
        reason: `bye ${TOKEN}\nERROR forged\tline ${"x".repeat(400)}`,
      }),
      TOKEN,
    );
    expect(line).toContain("[token]");
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\t");
    expect(line.length).toBeLessThan(400);
  });
});

function client(url: string, { name = "t", token = TOKEN, answer = true } = {}) {
  const ws = new WebSocket(url);
  const state = { closed: null as number | null, acks: 0, answer };
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ id: "h", type: "hello", payload: { token, client: name } }));
  });
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.type === "ping" && state.answer) ws.send(JSON.stringify({ type: "pong", id: msg.id }));
    if (msg.type === "ack") state.acks += 1;
  });
  ws.addEventListener("close", (e) => {
    state.closed = e.code;
  });
  cleanups.push(() => ws.close());
  return { ws, state };
}

function fakeHeartbeat() {
  let at = 0;
  let fire: (() => void) | undefined;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
    pingTicker: (tick: () => void) => {
      fire = tick;
      return () => {
        fire = undefined;
      };
    },
    tick: () => fire?.(),
  };
}

function serve(extra: Parameters<typeof startServer>[0] extends infer O ? Partial<O> : never) {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...extra,
  });
  servers.push(server);
  return server;
}

describe("conn-close-log: invisible characters of a peer (issue #1532)", () => {
  test("a line separator, a bidi override and a zero-width character cannot start a line or reorder the text", () => {
    // Named by code point: a literal one in the source is what a reader cannot see.
    const [ls, ps, rlo, pdi, zwsp, bom] = [0x2028, 0x2029, 0x202e, 0x2066, 0x200b, 0xfeff].map(
      (code) => String.fromCodePoint(code),
    );
    const line = closeLine(
      facts({
        client: `a${ls}ERROR fake${rlo}evil`,
        reason: `b${ps}c${pdi}d${zwsp}e${bom}f`,
      }),
      TOKEN,
    );
    for (const hidden of [ls, ps, rlo, pdi, zwsp, bom]) expect(line).not.toContain(hidden ?? "?");
    expect(line).toContain('client "a ERROR fake evil"');
    expect(line).toContain('code 1001 "b c d e f"');
  });
});

describe("conn-close-log: the server writes it for each way a connection closes (issue #1532)", () => {
  test("a client that stops answering is closed by the heartbeat, and the line says so", async () => {
    const lines: string[] = [];
    const beat = fakeHeartbeat();
    const c = client(
      serve({
        pingIntervalMs: 1000,
        now: beat.now,
        pingTicker: beat.pingTicker,
        log: (m) => lines.push(m),
      }).url,
    );
    expect(await poll(() => c.state.acks === 1)).toBe(true);
    c.state.answer = false;
    for (let i = 0; i < 5; i++) {
      beat.advance(1000);
      beat.tick();
    }
    expect(await poll(() => c.state.closed !== null)).toBe(true);
    expect(await poll(() => lines.length > 0)).toBe(true);
    expect(lines).toEqual([
      'connection #1 closed: client "t", code 4408 "heartbeat timeout", by the daemon (heartbeat), up 5 s, last frame 5 s ago, no pong yet',
    ]);
  });

  test("a close by the client is by the peer, with the code and reason it gave", async () => {
    const lines: string[] = [];
    const c = client(serve({ log: (m) => lines.push(m) }).url);
    expect(await poll(() => c.state.acks === 1)).toBe(true);
    c.ws.close(1000, "bye");
    expect(await poll(() => lines.length > 0)).toBe(true);
    expect(lines[0]).toMatch(
      /^connection #1 closed: client "t", code 1000 "bye", by the peer, up \d+ s, last frame \d+ s ago, no pong yet$/,
    );
  });

  test("a wrong token is closed by the daemon as unauthorized, and the token tried is not in the line", async () => {
    const lines: string[] = [];
    const tried = "wrong-token-0123456789abcdef";
    const c = client(serve({ log: (m) => lines.push(m) }).url, { token: tried });
    expect(await poll(() => c.state.closed !== null)).toBe(true);
    expect(await poll(() => lines.length > 0)).toBe(true);
    expect(lines[0]).toContain("client unknown, code 4401");
    expect(lines[0]).toContain("by the daemon (unauthorized)");
    expect(lines[0]).not.toContain(tried);
    expect(lines[0]).not.toContain(TOKEN);
  });

  test("a client that echoes the token in its name or reason does not put it in the log", async () => {
    const lines: string[] = [];
    const c = client(serve({ log: (m) => lines.push(m) }).url, { name: `app-${TOKEN}` });
    expect(await poll(() => c.state.acks === 1)).toBe(true);
    c.ws.close(1000, `see ${TOKEN}`);
    expect(await poll(() => lines.length > 0)).toBe(true);
    expect(lines[0]).toContain("[token]");
    expect(lines[0]).not.toContain(TOKEN);
  });

  test("a server given no log still closes its connections", async () => {
    const c = client(serve({}).url);
    expect(await poll(() => c.state.acks === 1)).toBe(true);
    c.ws.close(1000, "bye");
    expect(await poll(() => c.state.closed !== null)).toBe(true);
  });
});
