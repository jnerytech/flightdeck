import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope, SessionSubscribeResult } from "@flightdeck/protocol";
import {
  type ConnectionStatus,
  HostConnection,
  type HostConnectionOptions,
  RequestError,
  statusLine,
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

  test("an unreachable host carries what failed, when it was tried and when the next try is due", async () => {
    const before = Date.now();
    const { conn } = connect("ws://127.0.0.1:1/v1/ws");
    await waitFor(() => conn.retry !== null, "retry state");
    const retry = conn.retry;
    expect(retry?.kind).toBe("refused");
    expect(retry?.lastTryAt).toBeGreaterThanOrEqual(before);
    expect(retry?.lastTryAt).toBeLessThanOrEqual(Date.now());
    // The first delay is the base one (10 ms here).
    expect((retry?.nextRetryAt ?? 0) - (retry?.lastTryAt ?? 0)).toBeGreaterThanOrEqual(10);
    expect((retry?.nextRetryAt ?? 0) - (retry?.lastTryAt ?? 0)).toBeLessThanOrEqual(40);
  });

  test("a link that drops after being online is lost, and coming back online clears the state", async () => {
    const { listen } = daemon();
    const first = listen();
    const { conn } = connect(first.url);
    await waitFor(() => conn.status === "online", "online");
    expect(conn.retry).toBeNull();
    await first.stop();
    await waitFor(() => conn.retry !== null, "retry state");
    expect(conn.retry?.kind).toBe("lost");
    listen(first.port);
    await waitFor(() => conn.status === "online", "back online");
    expect(conn.retry).toBeNull();
  });

  test("a hello that is never answered is a timeout", async () => {
    const { conn } = connect(quietHost(undefined, { ackHello: false }), TOKEN, {
      connectTimeoutMs: 80,
    });
    await waitFor(() => conn.retry?.kind === "timeout", "timeout state");
    expect(conn.retry?.kind).toBe("timeout");
  });

  test("wake tries at once instead of waiting out the backoff", async () => {
    const { listen } = daemon();
    const first = listen();
    const { conn } = connect(first.url, TOKEN, {
      baseDelayMs: 60_000,
      maxDelayMs: 60_000,
      wakeDebounceMs: 0,
    });
    await waitFor(() => conn.status === "online", "online");
    await first.stop();
    await waitFor(() => conn.status === "offline", "offline");
    listen(first.port);
    await Bun.sleep(100);
    expect(conn.status).toBe("offline");
    conn.wake();
    await waitFor(() => conn.status === "online", "online after wake");
  });

  test("wake starts the backoff over", async () => {
    const { conn } = connect("ws://127.0.0.1:1/v1/ws", TOKEN, {
      baseDelayMs: 100,
      maxDelayMs: 5000,
      wakeDebounceMs: 0,
    });
    const gap = () => (conn.retry?.nextRetryAt ?? 0) - (conn.retry?.lastTryAt ?? 0);
    await waitFor(() => gap() >= 200, "second failure");
    const seen = conn.retry?.lastTryAt ?? 0;
    // A wake-up that lands while a try is running is ignored by design: ask again until one acts.
    await waitFor(() => {
      conn.wake();
      return (conn.retry?.lastTryAt ?? 0) > seen && gap() === 100;
    }, "backoff restarted");
    expect(gap()).toBe(100);
  });

  test("wake calls close together make one reconnect, and an online host is left alone", async () => {
    const { conn, statuses } = connect("ws://127.0.0.1:1/v1/ws", TOKEN, {
      baseDelayMs: 60_000,
      maxDelayMs: 60_000,
      wakeDebounceMs: 10_000,
    });
    await waitFor(() => conn.status === "offline", "offline");
    const before = statuses.filter((s) => s === "connecting").length;
    conn.wake();
    conn.wake();
    conn.wake();
    await waitFor(() => statuses.filter((s) => s === "connecting").length > before, "one retry");
    await Bun.sleep(100);
    expect(statuses.filter((s) => s === "connecting")).toHaveLength(before + 1);
    const { listen } = daemon();
    const live = connect(listen().url, TOKEN, { wakeDebounceMs: 0 });
    await waitFor(() => live.conn.status === "online", "online");
    live.conn.wake();
    await Bun.sleep(100);
    expect(live.statuses).toEqual(["connecting", "online"]);
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

  /** A host that acks `hello`, then closes the link with `code` and `reason`, as the daemon's heartbeat does. */
  function closingHost(code: number, reason: string) {
    const server = Bun.serve({
      port: 0,
      fetch(request, srv) {
        return srv.upgrade(request) ? undefined : new Response("no", { status: 400 });
      },
      websocket: {
        message(ws, raw) {
          const frame = JSON.parse(String(raw)) as { id: string; type: string };
          if (frame.type !== "hello") return;
          const data = {
            hostName: "h",
            daemonVersion: "0.0.0",
            protocolVersion: 1,
            allowedRoots: [],
          };
          ws.send(JSON.stringify({ type: "ack", id: frame.id, ok: true, data }));
          ws.close(code, reason);
        },
      },
    });
    cleanups.push(() => server.stop(true));
    return `ws://127.0.0.1:${server.port}/v1/ws`;
  }

  test("a link the host closes keeps why: its close code and reason (#939)", async () => {
    const { conn } = connect(closingHost(4408, "heartbeat timeout"));
    await waitFor(() => conn.retry !== null, "the drop");
    expect([conn.lastDrop?.code, conn.lastDrop?.reason, conn.lastDrop?.byWatchdog]).toEqual([
      4408,
      "heartbeat timeout",
      false,
    ]);
  });

  test("a close reason is one plain line in the log, and a link the app lets go of keeps no old drop (#939)", async () => {
    const { conn } = connect(closingHost(4408, "evil\nERROR forged\tline"));
    await waitFor(() => conn.retry !== null, "the drop");
    const reason = conn.lastDrop?.reason;
    conn.dispose();
    expect([reason, conn.lastDrop]).toEqual(["evil ERROR forged line", null]);
  });

  test("a link the watchdog gives up keeps how long it was silent, and that it was online (#939)", async () => {
    const hand = handWatchdog();
    const { conn } = connect(quietHost(), TOKEN, {
      connectTimeoutMs: 1000,
      staleMs: 45_000,
      watchdog: hand.watchdog,
    });
    await waitFor(() => conn.status === "online", "online");
    hand.advance(46_000);
    hand.tick();
    hand.tick();
    expect(conn.lastDrop).toEqual({
      code: 1006,
      reason: "",
      byWatchdog: true,
      silentMs: 46_000,
      wasOnline: true,
    });
  });

  test("a hidden window whose timers run once a minute still answers pings on time, and the link stays online 10 minutes (#939)", async () => {
    const hand = handWatchdog();
    let ping: (frame: unknown) => void = () => {};
    let pongs = 0;
    const url = quietHost((send) => {
      ping = send;
    });
    const { conn, statuses } = connect(url, TOKEN, { watchdog: hand.watchdog });
    await waitFor(() => conn.status === "online", "online");
    // The pong goes out from the message itself, never from a timer: count what the host gets.
    const sent = (conn as unknown as { ws: WebSocket }).ws;
    const original = sent.send.bind(sent);
    sent.send = (data: string) => {
      if (String(data).includes('"pong"')) pongs++;
      original(data);
    };
    for (let step = 1; step <= 40; step++) {
      hand.advance(15_000);
      ping({ type: "ping", id: String(step) });
      await waitFor(() => pongs === step, `pong ${step}`);
      // The watchdog's interval, throttled: it runs once in four pings (once a minute).
      if (step % 4 === 0) hand.tick();
    }
    expect([statuses, conn.lastDrop, pongs]).toEqual([["connecting", "online"], null, 40]);
  });

  test("a host that pings every 15 s stays online for 10 minutes, with no drop (#939)", async () => {
    const hand = handWatchdog();
    let ping: (frame: unknown) => void = () => {};
    let pings = 0;
    const { conn, statuses } = connect(
      quietHost((send) => {
        ping = send;
      }),
      TOKEN,
      { watchdog: hand.watchdog, onPing: () => void pings++ },
    );
    await waitFor(() => conn.status === "online", "online");
    for (let step = 1; step <= 40; step++) {
      hand.advance(15_000);
      ping({ type: "ping", id: String(step) });
      await waitFor(() => pings === step, `ping ${step}`);
      hand.tick();
    }
    expect([statuses, conn.lastDrop, pings]).toEqual([["connecting", "online"], null, 40]);
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

describe("desktop: the app log of a host's link (#939)", () => {
  const drop = {
    code: 4408,
    reason: "heartbeat timeout",
    byWatchdog: false,
    silentMs: 45_200,
    wasOnline: true,
  };

  test("one WARN per drop of a link that was online, with why; the tries after it are INFO", () => {
    expect([
      statusLine("pc", "online", null),
      statusLine("pc", "offline", drop),
      statusLine("pc", "connecting", drop),
      statusLine("pc", "offline", { ...drop, code: 1006, reason: "", wasOnline: false }),
      statusLine("pc", "offline", { ...drop, code: 1006, reason: "", byWatchdog: true }),
      statusLine("pc", "unauthorized", null),
    ]).toEqual([
      { level: "info", text: "pc: online" },
      {
        level: "warn",
        text: "pc: offline, closed by the host (4408 heartbeat timeout), 45 s silent",
      },
      { level: "info", text: "pc: connecting" },
      { level: "info", text: "pc: offline, closed (1006), 45 s silent" },
      { level: "warn", text: "pc: offline, given up by the app after 45 s silent" },
      { level: "warn", text: "pc: unauthorized" },
    ]);
  });
});
