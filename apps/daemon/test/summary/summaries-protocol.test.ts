import { afterEach, describe, expect, test } from "bun:test";
import { type EventEnvelope, parseServerMessage } from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager, poll } from "../support/helpers.ts";
import { summaries } from "../support/summaries.ts";

const TOKEN = "resumos-token-0123456789abc";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

describe("resumos: pela rede", () => {
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
    const old = await manager.create({ cwd: project, prompt: "x" });
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

    const { sessionId } = await manager.create({ cwd: project, prompt: "novo" });
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
});
