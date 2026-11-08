import { afterEach, describe, expect, test } from "bun:test";
import { type EventEnvelope, parseServerMessage, type SessionEventOf } from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";

type Summary = SessionEventOf<"session.summary">;
const TOKEN = "watch-snapshot-token-0123456789";

const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

/**
 * Issue #1191: an app asks for the sessions' current summaries in the ack of `sessions.watch`, one
 * frame for them all, instead of one frame per session: at a few hundred sessions, the app renders
 * once for the connect, not once per session. The live summaries come as before.
 */
async function watched(snapshot: boolean) {
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
  const first = await manager.create({ cwd: project, prompt: "a" });
  const second = await manager.create({ cwd: project, prompt: "b" });
  await poll(() =>
    [first, second].every(({ sessionId }) => manager.get(sessionId).status === "idle"),
  );
  const ws = new WebSocket(server.url);
  const messages: ReturnType<typeof parseServerMessage>[] = [];
  ws.addEventListener("message", (m) => messages.push(parseServerMessage(String(m.data))));
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(
    JSON.stringify({
      id: "2",
      type: "sessions.watch",
      payload: snapshot ? { snapshot: "ack" } : {},
    }),
  );
  const hello = await poll(() => messages.find((m) => m.type === "ack" && m.id === "1"));
  const ack = await poll(() => messages.find((m) => m.type === "ack" && m.id === "2"));
  const events = () =>
    messages.flatMap((m) =>
      m.type === "event" && (m as EventEnvelope).event.type === "session.summary"
        ? [(m as EventEnvelope).event as Summary]
        : [],
    );
  return { manager, project, ws, hello, ack, events, ids: [first.sessionId, second.sessionId] };
}

describe("sessions-watch-snapshot: the current summaries in one frame (#1191)", () => {
  test("the host says it can; asked to, it answers the watch with every summary and sends none of them as frames; live ones still come", async () => {
    const { manager, project, ws, hello, ack, events, ids } = await watched(true);
    const features =
      (hello as { data?: { features?: string[] } }).data?.features?.includes("watch.snapshot") ??
      false;
    const data = (ack as { ok: boolean; data?: { summaries?: Summary[] } }).data;
    const inAck = (data?.summaries ?? []).map((s) => [s.sessionId, s.status]).sort();
    const live = await manager.create({ cwd: project, prompt: "c" });
    await poll(() => events().some((s) => s.sessionId === live.sessionId && s.status === "idle"));
    const framed = events().filter((s) => ids.includes(s.sessionId));
    ws.close();
    expect([features, (ack as { ok: boolean }).ok, inAck, framed]).toEqual([
      true,
      true,
      ids.map((id) => [id, "idle"]).sort(),
      [],
    ]);
  });

  test("an app that does not ask gets the summaries as frames, as before", async () => {
    const { ws, ack, events, ids } = await watched(false);
    await poll(() => events().length >= 2);
    const framed = events()
      .map((s) => s.sessionId)
      .sort();
    ws.close();
    expect([(ack as { ok: boolean; data?: unknown }).data ?? null, framed]).toEqual([
      null,
      [...ids].sort(),
    ]);
  });
});
