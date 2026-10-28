import { afterEach, describe, expect, test } from "bun:test";
import {
  Command,
  type EventEnvelope,
  parseServerMessage,
  SessionEvent,
  type SessionEventOf,
} from "@flightdeck/protocol";
import { applyEnvelope, emptySession } from "../../desktop/src/lib/session-state.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";

type Summary = SessionEventOf<"session.summary">;
const TOKEN = "resumos-token-0123456789abc";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

const summaries = (list: EventEnvelope[]) =>
  list.flatMap((e) => (e.event.type === "session.summary" ? [e.event as Summary] : []));

describe("resumos", () => {
  test("schema: sessions.watch e session.summary", () => {
    expect(Command.safeParse({ id: "1", type: "sessions.watch", payload: {} }).success).toBe(true);
    const summary = {
      type: "session.summary",
      sessionId: "s",
      name: null,
      cwd: "/p",
      status: "awaiting_permission",
      pendingPermissions: [
        { requestId: "r", toolName: "Bash", createdAt: "2026-10-28T00:00:00.000Z" },
      ],
      updatedAt: "2026-10-28T00:00:00.000Z",
    };
    expect(SessionEvent.safeParse(summary).success).toBe(true);
    expect(SessionEvent.safeParse({ ...summary, status: "x" }).success).toBe(false);
  });

  test("watch recebe o estado atual e um resumo a cada mudança de estado e de pendências", async () => {
    const { manager, project } = newManager();
    const existing = manager.create({ cwd: project, prompt: "antes" });
    await poll(() => manager.get(existing.sessionId).status === "idle");

    const received: EventEnvelope[] = [];
    const watch = manager.watchSummaries((e) => received.push(e));
    expect(summaries(watch.snapshot).map((s) => [s.sessionId, s.status])).toEqual([
      [existing.sessionId, "idle"],
    ]);

    const { sessionId } = manager.create({ cwd: project, prompt: "[tool]", name: "n" });
    const waiting = await poll(() =>
      summaries(received).find(
        (s) => s.sessionId === sessionId && s.pendingPermissions.length === 1,
      ),
    );
    expect(waiting?.status).toBe("awaiting_permission");
    expect(waiting?.name).toBe("n");
    expect(waiting?.pendingPermissions[0]?.toolName).toBe("Write");
    expect(Date.parse(waiting?.pendingPermissions[0]?.createdAt ?? "")).not.toBeNaN();

    manager.respondPermission({
      requestId: waiting?.pendingPermissions[0]?.requestId ?? "",
      decision: "allow",
    });
    await poll(() => manager.get(sessionId).status === "idle");
    const statuses = summaries(received)
      .filter((s) => s.sessionId === sessionId)
      .map((s) => `${s.status}:${s.pendingPermissions.length}`);
    expect(statuses).toEqual([
      "starting:0",
      "running:0",
      "awaiting_permission:1",
      "running:0",
      "idle:0",
    ]);

    watch.unwatch();
    const before = received.length;
    await manager.close(sessionId);
    expect(received.length).toBe(before);
  });

  test("sessions.watch pela rede: ack, resumos atuais e depois ao vivo; resumo é efêmero", async () => {
    const { manager, project } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    servers.push(server);
    const old = manager.create({ cwd: project, prompt: "x" });
    await poll(() => manager.get(old.sessionId).status === "idle");

    const ws = new WebSocket(server.url);
    const messages: ReturnType<typeof parseServerMessage>[] = [];
    ws.addEventListener("message", (m) => messages.push(parseServerMessage(String(m.data))));
    await new Promise((r) => ws.addEventListener("open", r));
    ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
    ws.send(JSON.stringify({ id: "2", type: "sessions.watch", payload: {} }));
    const ack = await poll(() => messages.find((m) => m.type === "ack" && m.id === "2"));
    expect(ack).toMatchObject({ ok: true });
    const events = () => messages.filter((m): m is EventEnvelope => m.type === "event");
    await poll(() => summaries(events()).length > 0, 1000);
    expect(summaries(events()).map((s) => s.sessionId)).toEqual([old.sessionId]);

    const { sessionId } = manager.create({ cwd: project, prompt: "novo" });
    const live = () =>
      summaries(events())
        .filter((s) => s.sessionId === sessionId)
        .map((s) => s.status);
    await poll(() => live().includes("idle"));
    expect(live()).toEqual(["starting", "running", "idle"]);
    // Ephemeral: carries the last persisted seq and never shows up in the replay.
    const lastSummary = events()
      .filter((e) => e.event.type === "session.summary")
      .at(-1);
    expect(lastSummary?.seq).toBe(manager.get(sessionId).lastSeq);
    expect(
      manager
        .subscribe(sessionId, 0, () => {})
        .replay.some((e) => e.event.type === "session.summary"),
    ).toBe(false);
    ws.close();
  });

  test("watcher com erro não quebra a sessão", async () => {
    const { manager, project } = newManager();
    let calls = 0;
    manager.watchSummaries(() => {
      calls++;
      throw new Error("watcher quebrado");
    });
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    await poll(() => manager.get(sessionId).status === "idle");
    expect(manager.get(sessionId).status).toBe("idle");
    expect(calls).toBeGreaterThan(0);
  });

  test("o reducer de sessão do app ignora session.summary: a barra lateral é que usa os resumos", () => {
    const state = { ...emptySession(), lastSeq: 3 };
    const next = applyEnvelope(state, {
      type: "event",
      sessionId: "s",
      seq: 4,
      ts: "2026-10-28T00:00:00.000Z",
      event: {
        type: "session.summary",
        sessionId: "s",
        name: null,
        cwd: "/p",
        status: "idle",
        pendingPermissions: [],
        updatedAt: "2026-10-28T00:00:00.000Z",
      },
    });
    expect(next).toBe(state);
  });

  test("dois pedidos simultâneos geram resumos com 1 e 2 pendências", async () => {
    const { manager, project } = newManager({
      runtime: {
        start: (opts) => ({
          events: (async function* () {
            yield { type: "session.init" as const, claudeSessionId: "c", model: "m", tools: [] };
            await new Promise(() => {});
          })(),
          send: () => {
            for (const tool of ["Bash", "Write"]) {
              void opts.canUseTool(tool, {}, { signal: new AbortController().signal });
            }
          },
          interrupt: async () => {},
          close: async () => {},
        }),
      },
    });
    const received: EventEnvelope[] = [];
    manager.watchSummaries((e) => received.push(e));
    const { sessionId } = manager.create({ cwd: project, prompt: "duas" });
    const flat = () =>
      summaries(received)
        .filter((s) => s.sessionId === sessionId)
        .map((s) => `${s.status}:${s.pendingPermissions.map((p) => p.toolName).join(",")}`);
    await poll(() => flat().length >= 3, 1000);
    expect(flat()).toEqual([
      // The requests arrive on send, before init is consumed: starting goes straight to waiting.
      "starting:",
      "awaiting_permission:Bash",
      "awaiting_permission:Bash,Write",
    ]);
  });
});
