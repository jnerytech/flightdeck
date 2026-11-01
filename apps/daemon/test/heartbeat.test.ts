import { afterEach, describe, expect, test } from "bun:test";
import { CLOSE_HEARTBEAT } from "@flightdeck/protocol";
import { HostConnection } from "../../desktop/src/lib/host-connection.ts";
import { PING_INTERVAL_MS, type RunningServer, startServer } from "../src/server.ts";
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

function serve(pingIntervalMs: number) {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    pingIntervalMs,
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

  test("qualquer quadro do cliente conta como vivo: quem fala sem dar pong não é desconectado, e quem se cala é", async () => {
    const c = client(serve(25).url);
    await poll(() => c.pings.length >= 2, 2000);
    c.state.answer = false;
    // Commands keep arriving, as a busy page's do, but its pongs are late.
    const talk = setInterval(
      () => c.ws.send(JSON.stringify({ id: "q", type: "session.list", payload: {} })),
      10,
    );
    cleanups.push(() => clearInterval(talk));
    const before = c.pings.length;
    await poll(() => c.pings.length - before >= 10, 3000);
    expect(c.state.closed).toBeNull();
    clearInterval(talk);
    await poll(() => c.state.closed !== null, 2000);
    expect(c.state.closed).toBe(4408);
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
