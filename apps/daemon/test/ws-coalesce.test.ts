import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope } from "@flightdeck/protocol";
import { coalesceDeltas, DELTA_WINDOW_MS, drainAll } from "../src/delta-coalescer.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, waitFor } from "./helpers.ts";

const delta = (text: string, seq = 7): EventEnvelope => ({
  type: "event",
  sessionId: "s1",
  seq,
  ts: "2026-11-01T12:00:00.000Z",
  event: { type: "message.delta", text },
});
const persisted = (seq: number): EventEnvelope => ({
  type: "event",
  sessionId: "s1",
  seq,
  ts: "2026-11-01T12:00:00.000Z",
  event: { type: "message.assistant", blocks: [{ type: "text", text: "done" }] },
});

/** A clock the test moves by hand, and what the coalescer sent. */
function setup(backlog = () => 0) {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const sent: EventEnvelope[] = [];
  const coalescer = coalesceDeltas({
    deliver: (envelope) => sent.push(envelope),
    backlog,
    schedule: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  /** Moves the clock; the timers that fall due run in order. */
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.live = false;
      due.run();
    }
    now = target;
  };
  return { coalescer, sent, advance };
}

const texts = (sent: EventEnvelope[]) =>
  sent.map((e) => (e.event.type === "message.delta" ? e.event.text : `<${e.event.type}>`));

describe("ws-coalesce: the text of a stream goes to a client in few frames, in order", () => {
  test("200 deltas in one second (5 ms apart) reach the client in at most 45 frames, with the same text", () => {
    const { coalescer, sent, advance } = setup();
    let expected = "";
    for (let i = 0; i < 200; i++) {
      const piece = `w${i} `;
      expected += piece;
      coalescer.push(delta(piece));
      advance(5);
    }
    advance(DELTA_WINDOW_MS);
    expect(sent.length).toBeLessThanOrEqual(45);
    expect(sent.length).toBeGreaterThan(10);
    expect(texts(sent).join("")).toBe(expected);
  });

  test("a frame holds what came in its window, and is sent when the window ends", () => {
    const { coalescer, sent, advance } = setup();
    coalescer.push(delta("a"));
    coalescer.push(delta("b"));
    advance(DELTA_WINDOW_MS - 1);
    expect(sent).toEqual([]);
    advance(1);
    expect(texts(sent)).toEqual(["ab"]);
    coalescer.push(delta("c"));
    advance(DELTA_WINDOW_MS);
    expect(texts(sent)).toEqual(["ab", "c"]);
  });

  test("any other event sends the pending text first, and keeps its own seq", () => {
    const { coalescer, sent } = setup();
    coalescer.push(delta("a", 7));
    coalescer.push(delta("b", 7));
    coalescer.push(persisted(8));
    coalescer.push(delta("c", 8));
    expect(texts(sent)).toEqual(["ab", "<message.assistant>"]);
    expect(sent.map((e) => e.seq)).toEqual([7, 8]);
  });

  test("a client whose socket has not drained gets no frame until it does, and then one with everything", () => {
    let held = 5000;
    const { coalescer, sent, advance } = setup(() => held);
    coalescer.push(delta("a"));
    advance(DELTA_WINDOW_MS * 4);
    coalescer.push(delta("b"));
    advance(DELTA_WINDOW_MS * 4);
    expect(sent).toEqual([]);
    held = 0;
    coalescer.drain();
    expect(texts(sent)).toEqual(["ab"]);
    coalescer.drain();
    expect(texts(sent)).toEqual(["ab"]);
  });

  test("an event that is not a delta is sent even when the socket has not drained: the order is kept", () => {
    const { coalescer, sent } = setup(() => 5000);
    coalescer.push(delta("a"));
    coalescer.push(persisted(8));
    expect(texts(sent)).toEqual(["a", "<message.assistant>"]);
  });

  test("drainAll tells every subscription of a client that its socket has room", () => {
    let held = 5000;
    const first = setup(() => held);
    const second = setup(() => held);
    first.coalescer.push(delta("a"));
    second.coalescer.push(delta("b"));
    first.advance(DELTA_WINDOW_MS * 2);
    expect([first.sent, second.sent]).toEqual([[], []]);
    held = 0;
    drainAll({ data: { coalescers: new Set([first.coalescer, second.coalescer]) } });
    expect(texts(first.sent)).toEqual(["a"]);
    expect(texts(second.sent)).toEqual(["b"]);
  });

  test("stop forgets the pending text and the timer", () => {
    const { coalescer, sent, advance } = setup();
    coalescer.push(delta("a"));
    coalescer.stop();
    advance(DELTA_WINDOW_MS * 2);
    coalescer.drain();
    expect(sent).toEqual([]);
  });
});

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
