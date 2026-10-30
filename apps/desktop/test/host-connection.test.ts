import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope, SessionSubscribeResult } from "@flightdeck/protocol";
import { type ConnectionStatus, HostConnection, RequestError } from "../src/lib/host-connection.ts";
import { daemon as makeDaemon, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const daemon = () => makeDaemon(cleanups);

function connect(url: string, token = TOKEN) {
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
});
