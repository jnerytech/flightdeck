import { afterEach, describe, expect, test } from "bun:test";
import {
  type Ack,
  CLOSE_UNAUTHORIZED,
  type EventEnvelope,
  PROTOCOL_VERSION,
  parseServerMessage,
} from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, tempDir, waitFor } from "./helpers.ts";

const TOKEN = "test-token-0123456789abcdef";

/** Minimal protocol client used by the tests. */
class TestClient {
  readonly ws: WebSocket;
  readonly events: EventEnvelope[] = [];
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private nextId = 0;
  closed: { code: number; reason: string } | null = null;
  readonly opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
    });
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "event") this.events.push(parsed);
      else this.acks.get(parsed.id)?.(parsed);
    });
    this.ws.addEventListener("close", (e) => {
      this.closed = { code: e.code, reason: e.reason };
    });
  }

  async raw(frame: string): Promise<void> {
    await this.opened;
    this.ws.send(frame);
  }

  async request(type: string, payload: unknown): Promise<Ack> {
    await this.opened;
    const id = String(++this.nextId);
    const ack = new Promise<Ack>((resolve) => this.acks.set(id, resolve));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return ack;
  }

  async ok<T = unknown>(type: string, payload: unknown): Promise<T> {
    const ack = await this.request(type, payload);
    if (!ack.ok) throw new Error(`${type} falhou: ${ack.error.code} ${ack.error.message}`);
    return ack.data as T;
  }

  async waitClosed(): Promise<{ code: number; reason: string }> {
    return waitFor(() => this.closed, { label: "close" });
  }

  close(): void {
    this.ws.close();
  }
}

const servers: RunningServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

function setup(overrides: Parameters<typeof newManager>[0] = {}) {
  const ctx = newManager(overrides);
  const server = startServer({
    manager: ctx.manager,
    hostName: "host-teste",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  servers.push(server);
  const connect = async (hello = true) => {
    const client = new TestClient(server.url);
    if (hello) await client.ok("hello", { token: TOKEN, client: "test" });
    return client;
  };
  return { ...ctx, server, connect };
}

describe("autenticação", () => {
  test("frame antes do hello fecha com 4401", async () => {
    const { connect } = setup();
    const client = await connect(false);
    await client.raw(JSON.stringify({ id: "1", type: "session.list", payload: {} }));
    expect((await client.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED);
  });

  test("JSON inválido antes do hello fecha com 4401", async () => {
    const { connect } = setup();
    const client = await connect(false);
    await client.raw("{nope");
    expect((await client.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED);
  });

  test("token errado fecha com 4401", async () => {
    const { connect } = setup();
    const client = await connect(false);
    void client.request("hello", { token: "errado", client: "test" });
    expect((await client.waitClosed()).code).toBe(CLOSE_UNAUTHORIZED);
  });

  test("token certo responde hostName e versões", async () => {
    const { connect } = setup();
    const client = await connect(false);
    const data = await client.ok<Record<string, unknown>>("hello", {
      token: TOKEN,
      client: "test",
    });
    expect(data.hostName).toBe("host-teste");
    expect(data.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(typeof data.daemonVersion).toBe("string");
    expect(client.closed).toBeNull();
    client.close();
  });

  test("rota diferente de /v1/ws não faz upgrade", async () => {
    const { server } = setup();
    const res = await fetch(server.url.replace("ws://", "http://").replace("/v1/ws", "/outra"));
    expect(res.status).toBe(404);
  });
});

describe("protocolo", () => {
  test("payload inválido é recusado com ack ok:false", async () => {
    const { connect } = setup();
    const client = await connect();
    const ack = await client.request("session.create", { cwd: 42 });
    expect(ack).toMatchObject({ type: "ack", id: "2", ok: false, error: { code: "bad_request" } });
    const unknown = await client.request("session.explode", {});
    expect(unknown).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(client.closed).toBeNull();
    client.close();
  });

  test("cwd proibido volta como ack ok:false forbidden_cwd", async () => {
    const { connect } = setup();
    const client = await connect();
    const ack = await client.request("session.create", { cwd: tempDir("fd-out-"), prompt: "oi" });
    expect(ack).toMatchObject({ ok: false, error: { code: "forbidden_cwd" } });
    client.close();
  });

  test("session.list e session.create pela rede", async () => {
    const { connect, project } = setup();
    const client = await connect();
    const { sessionId } = await client.ok<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "oi",
      name: "teste",
    });
    const { sessions } = await client.ok<{ sessions: Array<{ id: string; name: string }> }>(
      "session.list",
      {},
    );
    expect(sessions.map((s) => [s.id, s.name])).toEqual([[sessionId, "teste"]]);
    client.close();
  });
});

describe("replay", () => {
  test("cliente que cai e volta com sinceSeq recebe exatamente o que perdeu", async () => {
    const { connect, project, store, manager } = setup();
    const first = await connect();
    const { sessionId } = await first.ok<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "[tool]",
    });
    await first.ok("session.subscribe", { sessionId, sinceSeq: 0 });
    const request = await waitFor(
      () => first.events.find((e) => e.event.type === "permission.requested"),
      { label: "permission.requested" },
    );
    const persisted = (list: EventEnvelope[]) =>
      list.filter((e) => e.event.type !== "message.delta");
    const lastSeen = Math.max(...persisted(first.events).map((e) => e.seq));
    first.close();
    await first.waitClosed();

    // While the first client is away, another one approves and the turn finishes.
    const other = await connect();
    if (request.event.type !== "permission.requested") throw new Error("unreachable");
    await other.ok("permission.respond", { requestId: request.event.requestId, decision: "allow" });
    await waitFor(() => manager.get(sessionId).status === "idle", { label: "idle" });

    const back = await connect();
    const sub = await back.ok<{ replayed: number }>("session.subscribe", {
      sessionId,
      sinceSeq: lastSeen,
    });
    const expected = store.eventsSince(sessionId, lastSeen);
    await waitFor(() => back.events.length >= expected.length, { label: "replay" });
    expect(sub.replayed).toBe(expected.length);
    expect(back.events.map((e) => e.seq)).toEqual(expected.map((e) => e.seq));
    expect(back.events.map((e) => e.seq)[0]).toBe(lastSeen + 1);
    expect(back.events.map((e) => e.event.type)).toContain("permission.resolved");
    expect(back.events.map((e) => e.event.type)).toContain("turn.result");

    // Live events keep flowing after the replay, continuing the sequence.
    await back.ok("session.send", { sessionId, text: "de novo" });
    await waitFor(() => back.events.filter((e) => e.event.type === "turn.result").length === 2, {
      label: "segundo turno",
    });
    const seqs = persisted(back.events).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => lastSeen + 1 + i));
    back.close();
    other.close();
  });

  test("message.delta carrega o último seq persistido sem avançá-lo", async () => {
    const { connect, project } = setup();
    const client = await connect();
    const { sessionId } = await client.ok<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "uma resposta comprida",
    });
    await client.ok("session.subscribe", { sessionId });
    await waitFor(() => client.events.some((e) => e.event.type === "turn.result"));
    for (const [i, envelope] of client.events.entries()) {
      if (envelope.event.type !== "message.delta") continue;
      const previous = client.events.slice(0, i).filter((e) => e.event.type !== "message.delta");
      expect(envelope.seq).toBe(previous.at(-1)?.seq ?? 0);
    }
    client.close();
  });

  test("unsubscribe para de entregar eventos", async () => {
    const { connect, project, manager } = setup();
    const client = await connect();
    const { sessionId } = await client.ok<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "oi",
    });
    await client.ok("session.subscribe", { sessionId });
    await waitFor(() => manager.get(sessionId).status === "idle");
    await client.ok("session.unsubscribe", { sessionId });
    const before = client.events.length;
    await client.ok("session.send", { sessionId, text: "mais" });
    await waitFor(
      () => manager.get(sessionId).status === "idle" && manager.get(sessionId).lastSeq > 0,
    );
    await Bun.sleep(30);
    expect(client.events.length).toBe(before);
    client.close();
  });
});

describe("protocolo — comandos restantes", () => {
  test("interrupt, close, resume e respostas de erro pela rede", async () => {
    const { connect, project, manager } = setup();
    const client = await connect();
    const { sessionId } = await client.ok<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "[tool]",
    });
    await waitFor(() => manager.get(sessionId).status === "awaiting_permission");
    await client.ok("session.interrupt", { sessionId });
    await waitFor(() => manager.get(sessionId).status === "idle");
    await client.ok("session.close", { sessionId });
    expect(manager.get(sessionId).status).toBe("ended");
    await client.ok("session.resume", { sessionId });
    expect(manager.get(sessionId).status).toBe("idle");
    const missing = await client.request("session.send", { sessionId: "nope", text: "x" });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
    await client.ok("hello", { token: TOKEN, client: "de novo" });
    client.close();
  });

  test("JSON inválido depois do hello recebe ack de erro sem derrubar a conexão", async () => {
    const { connect } = setup();
    const client = await connect();
    const acks: unknown[] = [];
    client.ws.addEventListener("message", (m) => acks.push(JSON.parse(String(m.data))));
    await client.raw("{quebrado");
    await waitFor(() => acks.length > 0);
    expect(acks[0]).toMatchObject({
      type: "ack",
      id: "",
      ok: false,
      error: { code: "bad_request" },
    });
    const noId = await client.raw(JSON.stringify({ type: "session.list" }));
    expect(noId).toBeUndefined();
    await waitFor(() => acks.length > 1);
    expect(acks[1]).toMatchObject({ id: "", ok: false });
    expect(client.closed).toBeNull();
    client.close();
  });

  test("erro inesperado vira ack internal", async () => {
    const { connect, project } = setup({
      runtime: {
        start: () => {
          throw new Error("runtime quebrado");
        },
      },
    });
    const client = await connect();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const ack = await client.request("session.create", { cwd: project, prompt: "oi" });
      expect(ack).toMatchObject({ ok: false, error: { code: "internal" } });
      expect(errors).toHaveLength(1);
    } finally {
      console.error = original;
    }
    client.close();
  });

  test("subscribe repetido troca a inscrição sem duplicar eventos", async () => {
    const { connect, project, manager } = setup();
    const client = await connect();
    const { sessionId } = await client.ok<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "oi",
    });
    await waitFor(() => manager.get(sessionId).status === "idle");
    await client.ok("session.subscribe", { sessionId });
    const lastSeq = manager.get(sessionId).lastSeq;
    await client.ok("session.subscribe", { sessionId, sinceSeq: lastSeq });
    await client.ok("session.send", { sessionId, text: "mais" });
    await waitFor(
      () => manager.get(sessionId).status === "idle" && manager.get(sessionId).lastSeq > lastSeq,
    );
    await Bun.sleep(20);
    const seqs = client.events.filter((e) => e.event.type !== "message.delta").map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    await client.ok("session.unsubscribe", { sessionId: "nunca-inscrito" });
    client.close();
  });

  test("GET em /v1/ws sem upgrade responde 426", async () => {
    const { server } = setup();
    const res = await fetch(server.url.replace("ws://", "http://"));
    expect(res.status).toBe(426);
  });

  test("bind IPv6 gera URL com colchetes", async () => {
    const ctx = newManager();
    const server = startServer({
      manager: ctx.manager,
      hostName: "h",
      bind: "::1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    servers.push(server);
    expect(server.url).toMatch(/^ws:\/\/\[::1\]:\d+\/v1\/ws$/);
  });
});
