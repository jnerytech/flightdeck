import { afterEach, describe, expect, test } from "bun:test";
import { CLOSE_HEARTBEAT } from "@flightdeck/protocol";
import { HostConnection } from "../../desktop/src/lib/host-connection.ts";
import {
  PING_INTERVAL_MS,
  type RunningServer,
  type ServerOptions,
  startServer,
} from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";

const TOKEN = "heartbeat-token-0123456789ab";
const servers: RunningServer[] = [];
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const s of servers.splice(0)) await s.stop();
});

interface Ping {
  type: "ping";
  id: string;
  lastRttMs?: number;
}

/** Raw client; answers pings only while `answer` is true. */
function client(url: string, { hello = true, answer = true } = {}) {
  const ws = new WebSocket(url);
  const pings: Ping[] = [];
  const acks: unknown[] = [];
  const state = { closed: null as number | null, open: false, answer };
  ws.addEventListener("open", () => {
    state.open = true;
    if (hello)
      ws.send(JSON.stringify({ id: "h", type: "hello", payload: { token: TOKEN, client: "t" } }));
  });
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.type === "ping") {
      pings.push(msg);
      if (state.answer) ws.send(JSON.stringify({ type: "pong", id: msg.id }));
    } else acks.push(msg);
  });
  ws.addEventListener("close", (e) => {
    state.closed = e.code;
  });
  cleanups.push(() => ws.close());
  return { ws, pings, acks, state };
}

/** A hand-driven heartbeat: the test says when the ping tick fires and what time it is. */
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

function serve(pingIntervalMs: number, extra: Partial<ServerOptions> = {}) {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    pingIntervalMs,
    ...extra,
  });
  servers.push(server);
  return server;
}

describe("heartbeat", () => {
  test("intervalo padrão é 15 s e o fechamento por heartbeat usa 4408", () => {
    expect(PING_INTERVAL_MS).toBe(15_000);
    expect(CLOSE_HEARTBEAT).toBe(4408);
  });

  test("cliente que responde pong continua conectado e recebe a latência medida pelo daemon", async () => {
    const c = client(serve(25).url);
    await poll(() => c.pings.length >= 4);
    expect(c.pings.length).toBeGreaterThanOrEqual(4);
    expect(c.state.closed).toBeNull();
    expect(new Set(c.pings.map((p) => p.id)).size).toBe(c.pings.length);
    expect(c.pings[0]?.lastRttMs).toBeUndefined();
    expect(typeof c.pings.at(-1)?.lastRttMs).toBe("number");
    // pong is a control frame: the only ack is the hello one.
    expect(c.acks).toHaveLength(1);
  });

  test("cliente que para de responder é desconectado com 4408 após quatro pings", async () => {
    const c = client(serve(25).url);
    await poll(() => c.pings.length >= 2, 2000);
    expect(c.state.closed).toBeNull();
    c.state.answer = false;
    const answered = c.pings.length;
    await poll(() => c.state.closed !== null, 2000);
    expect(c.state.closed).toBe(4408);
    expect(c.pings.length - answered).toBe(4);
  });

  test("any client frame counts as alive: one that talks without answering pings stays, and one silent for 4 intervals is closed", async () => {
    const EVERY = 1000;
    const beat = fakeHeartbeat();
    const c = client(serve(EVERY, { now: beat.now, pingTicker: beat.pingTicker }).url);
    expect(await poll(() => c.acks.length === 1)).toBe(true);
    c.state.answer = false;
    // A busy page: a command arrives before every tick, but its pongs never do.
    for (let i = 1; i <= 8; i++) {
      beat.advance(EVERY);
      const acked = c.acks.length;
      c.ws.send(JSON.stringify({ id: `q${i}`, type: "session.list", payload: {} }));
      expect(await poll(() => c.acks.length > acked)).toBe(true);
      beat.tick();
      expect(await poll(() => c.pings.length === i)).toBe(true);
    }
    expect(c.state.closed).toBeNull();
    // Then it goes quiet: one millisecond short of 4 intervals it still stays, at 4 it is closed.
    beat.advance(4 * EVERY - 1);
    beat.tick();
    expect(await poll(() => c.pings.length === 9)).toBe(true);
    expect(c.state.closed).toBeNull();
    beat.advance(1);
    beat.tick();
    expect(await poll(() => c.state.closed !== null)).toBe(true);
    expect(c.state.closed).toBe(4408);
    expect(c.pings).toHaveLength(9);
  });

  test("sem hello não há ping; pong antes do hello fecha com 4401", async () => {
    const idle = client(serve(25).url, { hello: false });
    await poll(() => idle.state.open);
    await Bun.sleep(120);
    expect(idle.pings).toEqual([]);
    idle.ws.send(JSON.stringify({ type: "pong", id: "x" }));
    await poll(() => idle.state.closed !== null);
    expect(idle.state.closed).toBe(4401);
  });

  test("pong com id desconhecido ou sem id é ignorado e não gera ack", async () => {
    const c = client(serve(1000).url);
    await poll(() => c.acks.length === 1);
    c.ws.send(JSON.stringify({ type: "pong", id: "inventado" }));
    c.ws.send(JSON.stringify({ type: "pong" }));
    await Bun.sleep(50);
    expect(c.acks).toHaveLength(1);
    expect(c.state.closed).toBeNull();
  });

  test("o app responde os pings, continua online e expõe a latência", async () => {
    const server = serve(25);
    const statuses: string[] = [];
    let pinged = 0;
    const conn = new HostConnection({
      url: server.url,
      token: TOKEN,
      clientName: "teste",
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      onSubscribed: () => {},
      onPing: () => pinged++,
      lastSeqFor: () => 0,
    });
    cleanups.push(() => conn.dispose());
    conn.connect();
    await poll(() => typeof conn.latencyMs === "number" && pinged >= 4);
    expect(typeof conn.latencyMs).toBe("number");
    expect(pinged).toBeGreaterThanOrEqual(4);
    expect(conn.status).toBe("online");
    expect(statuses).toEqual(["connecting", "online"]);
  });
});
