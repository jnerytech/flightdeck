import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope } from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager, waitFor } from "../support/helpers.ts";

const TOKEN = "test-token-0123456789abcdef";
const servers: RunningServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

describe("ws-coalesce: a real client of a real server", () => {
  test("the text of a streamed answer reaches the client in fewer frames than the runtime made, with the same text", async () => {
    const { manager, root, project } = newManager();
    const server = startServer({
      manager,
      hostName: "host-teste",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    servers.push(server);
    const frames: EventEnvelope[] = [];
    const ws = new WebSocket(server.url);
    const acks = new Map<string, (data: unknown) => void>();
    ws.addEventListener("message", (message) => {
      const frame = JSON.parse(String(message.data));
      if (frame.type === "event") frames.push(frame);
      else if (frame.type === "ack") acks.get(frame.id)?.(frame.data);
    });
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    let id = 0;
    const ask = (type: string, payload: unknown) =>
      new Promise<{ sessionId: string }>((resolve) => {
        const key = String(++id);
        acks.set(key, resolve as (data: unknown) => void);
        ws.send(JSON.stringify({ id: key, type, payload }));
      });
    await ask("hello", { token: TOKEN, client: "test" });
    const { sessionId } = await ask("session.create", {
      cwd: project,
      prompt: "oi",
    });
    await waitFor(() => manager.get(sessionId).status === "idle");
    // What the runtime made, counted where the server hands events to its clients.
    const raw: string[] = [];
    manager.subscribe(sessionId, Number.MAX_SAFE_INTEGER, (envelope) => {
      if (envelope.event.type === "message.delta") raw.push(envelope.event.text);
    });
    await ask("session.subscribe", { sessionId, sinceSeq: manager.get(sessionId).lastSeq });
    await ask("session.send", { sessionId, text: "uma resposta comprida" });
    await waitFor(() => frames.some((e) => e.event.type === "turn.result"));
    const received = frames.flatMap((e) =>
      e.event.type === "message.delta" ? [e.event.text] : [],
    );
    expect(raw.length).toBeGreaterThan(3);
    expect(received.length).toBeLessThan(raw.length);
    expect(received.join("")).toBe(raw.join(""));
    ws.close();
  });
});
