import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope, SessionSubscribeResult } from "@flightdeck/protocol";
import {
  type ConnectionStatus,
  HostConnection,
  type HostConnectionOptions,
  RequestError,
} from "../src/lib/host-connection.ts";
import { daemon as makeDaemon, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const daemon = () => makeDaemon(cleanups);

function connect(url: string, token = TOKEN, extra: Partial<HostConnectionOptions> = {}) {
  const events: EventEnvelope[] = [];
  const statuses: ConnectionStatus[] = [];
  const subscribed: Array<[string, SessionSubscribeResult]> = [];
  const lastSeq = new Map<string, number>();
  const conn = new HostConnection({
    url,
    token,
    clientName: "test",
    baseDelayMs: 10,
    maxDelayMs: 40,
    lastSeqFor: (id) => lastSeq.get(id) ?? 0,
    ...extra,
    onEvent: (e) => {
      events.push(e);
      if (e.event.type !== "message.delta") lastSeq.set(e.sessionId, e.seq);
    },
    onStatus: (s) => statuses.push(s),
    onSubscribed: (id, result) => subscribed.push([id, result]),
  });
  cleanups.push(() => conn.dispose());
  conn.connect();
  return { conn, events, statuses, subscribed };
}

describe("desktop: conexão com o host", () => {
  test("hello deixa online e comandos funcionam", async () => {
    const { listen, project } = daemon();
    const server = listen();
    const { conn, statuses, events, subscribed } = connect(server.url);
    await waitFor(() => conn.status === "online", "online");
    expect(statuses).toEqual(["connecting", "online"]);
    expect(conn.info?.hostName).toBe("h1");
    const { sessionId } = await conn.request("session.create", { cwd: project, prompt: "oi" });
    conn.subscribe(sessionId);
    conn.subscribe(sessionId);
    await waitFor(() => events.some((e) => e.event.type === "turn.result"), "turn.result");
    expect(subscribed[0]?.[0]).toBe(sessionId);
    expect(subscribed[0]?.[1].session.id).toBe(sessionId);
    const { sessions } = await conn.request("session.list", {});
    expect(sessions).toHaveLength(1);
    conn.unsubscribe(sessionId);
  });

  test("ack de erro rejeita com RequestError e o código", async () => {
    const { listen } = daemon();
    const { conn } = connect(listen().url);
    await waitFor(() => conn.status === "online");
    const error = await conn.request("session.send", { sessionId: "x", text: "y" }).catch((e) => e);
    expect(error).toBeInstanceOf(RequestError);
    expect(error.code).toBe("not_found");
  });

  test("reconecta após queda e retoma do último seq sem duplicar", async () => {
    const { listen, project, manager } = daemon();
    const first = listen();
    const port = first.port;
    const { conn, events, statuses } = connect(first.url);
    await waitFor(() => conn.status === "online");
    const { sessionId } = await conn.request("session.create", { cwd: project, prompt: "oi" });
    conn.subscribe(sessionId);
    await waitFor(() => manager.get(sessionId).status === "idle" && events.length > 0);
    await Bun.sleep(20);

    await first.stop();
    await waitFor(() => conn.status === "offline", "offline");
    const pending = conn.request("session.list", {}).catch((e) => e);
    expect(await pending).toBeInstanceOf(RequestError);
    manager.send(sessionId, "enquanto offline");
    await waitFor(() => manager.get(sessionId).status === "idle");

    listen(port);
    await waitFor(
      () => conn.status === "online" && statuses.filter((s) => s === "online").length === 2,
      "reconectar",
    );
    await waitFor(
      () => events.filter((e) => e.event.type === "turn.result").length === 2,
      "replay",
    );
    const seqs = events.filter((e) => e.event.type !== "message.delta").map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  test("token errado fica unauthorized e não tenta de novo", async () => {
    const { listen } = daemon();
    const { conn, statuses } = connect(listen().url, "token-errado");
    await waitFor(() => conn.status === "unauthorized", "unauthorized");
    await Bun.sleep(60);
    expect(statuses).toEqual(["connecting", "unauthorized"]);
  });

  test("host inexistente fica offline e tenta reconectar; dispose para tudo", async () => {
    const { conn, statuses } = connect("ws://127.0.0.1:1/v1/ws");
    await waitFor(() => statuses.filter((s) => s === "connecting").length >= 2, "retentativa");
    conn.dispose();
    conn.dispose();
    const count = statuses.length;
    await Bun.sleep(60);
    expect(statuses).toHaveLength(count);
    expect(conn.status).toBe("offline");
    expect(await conn.request("session.list", {}).catch((e) => e.code)).toBe("offline");
    conn.unsubscribe("qualquer");
  });

  /** A host that acks `hello` and then says nothing but what `speak` sends: a half-open link. */
  function quietHost(
    speak?: (send: (frame: unknown) => void) => void,
    options: { ackHello?: boolean } = {},
  ) {
    const server = Bun.serve({
      port: 0,
      fetch(request, srv) {
        return srv.upgrade(request) ? undefined : new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          speak?.((frame) => ws.send(JSON.stringify(frame)));
        },
        message(ws, raw) {
          const frame = JSON.parse(String(raw)) as { id: string; type: string };
          if (frame.type !== "hello" || options.ackHello === false) return;
          const data = {
            hostName: "quieto",
            daemonVersion: "0.0.0",
            protocolVersion: 1,
            allowedRoots: [],
          };
          ws.send(JSON.stringify({ type: "ack", id: frame.id, ok: true, data }));
        },
      },
    });
    cleanups.push(() => server.stop(true));
    return `ws://127.0.0.1:${server.port}/v1/ws`;
  }

  test("a host that goes silent is dropped: the pending request fails and the app reconnects", async () => {
    const { conn, statuses } = connect(quietHost(), TOKEN, { staleMs: 80 });
    await waitFor(() => conn.status === "online", "online");
    const answer = await Promise.race([
      conn.request("session.list", {}).catch((e) => e),
      Bun.sleep(1000).then(() => "still waiting"),
    ]);
    expect(answer).toBeInstanceOf(RequestError);
    const error = answer as RequestError;
    expect(error.code).toBe("offline");
    expect(error.message).toBe("connection lost");
    expect(statuses).toContain("offline");
    await waitFor(() => statuses.filter((s) => s === "connecting").length >= 2, "reconnect");
  });

  test("a host that keeps pinging is not dropped, however slow its answer", async () => {
    const url = quietHost((send) => {
      const timer = setInterval(() => send({ type: "ping", id: "p" }), 20);
      cleanups.push(() => clearInterval(timer));
    });
    const { conn, statuses } = connect(url, TOKEN, { staleMs: 80 });
    await waitFor(() => conn.status === "online", "online");
    const slow = conn.request("session.list", {});
    await Bun.sleep(300);
    expect(conn.status).toBe("online");
    expect(statuses).toEqual(["connecting", "online"]);
    conn.dispose();
    expect(await slow.catch((e) => e.code)).toBe("offline");
  });

  test("the real daemon's own heartbeat keeps an idle link alive under the watchdog", async () => {
    const { listen } = daemon();
    const { conn, statuses } = connect(listen(0, 25).url, TOKEN, { staleMs: 120 });
    await waitFor(() => conn.status === "online", "online");
    await Bun.sleep(500);
    expect(conn.status).toBe("online");
    expect(statuses).toEqual(["connecting", "online"]);
    expect(conn.latencyMs).not.toBeNull();
  });

  /** A clock and an interval the test drives by hand: `tick()` is one check of the watchdog. */
  function handWatchdog() {
    let time = 0;
    const checks: Array<() => void> = [];
    return {
      watchdog: {
        now: () => time,
        repeat: (fn: () => void) => {
          checks.push(fn);
          return () => {
            const at = checks.indexOf(fn);
            if (at >= 0) checks.splice(at, 1);
          };
        },
      },
      advance: (ms: number) => {
        time += ms;
      },
      tick: () => {
        expect(checks.length).toBeGreaterThan(0);
        for (const check of [...checks]) check();
      },
    };
  }

  test("one stale check is only a suspicion: a frame that arrives before the next one keeps the link", async () => {
    const hand = handWatchdog();
    let speak: (frame: unknown) => void = () => {};
    const url = quietHost((send) => {
      speak = send;
    });
    const { conn, statuses } = connect(url, TOKEN, { staleMs: 1000, watchdog: hand.watchdog });
    await waitFor(() => conn.status === "online", "online");
    hand.advance(1500);
    hand.tick();
    expect(conn.status).toBe("online");
    speak({ type: "ping", id: "p", lastRttMs: 7 });
    await waitFor(() => conn.latencyMs === 7, "ping");
    hand.tick();
    expect(conn.status).toBe("online");
    expect(statuses).toEqual(["connecting", "online"]);
    // Silent again: the first check suspects, the second gives the link up.
    hand.advance(1500);
    hand.tick();
    expect(conn.status).toBe("online");
    const pending = conn.request("session.list", {}).catch((e) => e);
    hand.tick();
    expect(conn.status).toBe("offline");
    expect(((await pending) as RequestError).message).toBe("connection lost");
  });

  test("a hello that never comes back is given up after connectTimeoutMs, and the app retries", async () => {
    const hand = handWatchdog();
    const url = quietHost(undefined, { ackHello: false });
    const { conn, statuses } = connect(url, TOKEN, {
      connectTimeoutMs: 1000,
      staleMs: 60_000,
      watchdog: hand.watchdog,
    });
    await waitFor(() => statuses.includes("connecting"), "connecting");
    await Bun.sleep(50);
    expect(conn.status).toBe("connecting");
    hand.advance(1500);
    hand.tick();
    expect(conn.status).toBe("connecting");
    hand.tick();
    expect(conn.status).toBe("offline");
    await waitFor(() => statuses.filter((s) => s === "connecting").length >= 2, "retry");
  });

  test("a link that is online is not held to the connect timeout", async () => {
    const hand = handWatchdog();
    const { conn } = connect(quietHost(), TOKEN, {
      connectTimeoutMs: 1000,
      staleMs: 60_000,
      watchdog: hand.watchdog,
    });
    await waitFor(() => conn.status === "online", "online");
    hand.advance(5000);
    hand.tick();
    hand.tick();
    expect(conn.status).toBe("online");
  });
});
