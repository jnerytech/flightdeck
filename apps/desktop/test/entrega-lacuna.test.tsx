import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

const said = (seq: number) => ({
  seq,
  event: { type: "message.assistant", blocks: [{ type: "text", text: `resposta ${seq}` }] },
});
const frame = (seq: number, event: unknown) => ({
  type: "event",
  sessionId: "s1",
  seq,
  ts: "2026-10-31T12:00:00.000Z",
  event,
});

/** The app following session s1 of a daemon that already has events 1 to 4. */
async function follow() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.streams.s1 = [1, 2, 3, 4].map(said);
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.status === "online");
  store.select(hostId, "s1");
  const key = `${hostId}/s1`;
  await settle(() => store.getState().sessions[key]?.lastSeq === 4);
  const asked = () =>
    daemon.commands
      .filter((c) => c.type === "session.subscribe")
      .map((c) => (c.payload as { sinceSeq?: number }).sinceSeq);
  return { store, daemon, key, asked };
}

describe("entrega-lacuna: the app does not draw a conversation with holes", () => {
  test("a frame that skips a seq is not applied: the app asks again from its last seq and ends with every message", async () => {
    const { store, daemon, key, asked } = await follow();
    // Frame 5 was lost on the way; 6 arrives, and the daemon still has both.
    daemon.streams.s1?.push(said(5), said(6));
    daemon.push(frame(6, said(6).event));
    await settle(() => store.getState().sessions[key]?.lastSeq === 6);
    const session = store.getState().sessions[key];
    expect(session?.lastSeq).toBe(6);
    expect(session?.items.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(asked()).toEqual([0, 4]);
  });

  test("a streamed word (it carries the current seq), or a frame already seen, is not a gap", async () => {
    const { store, daemon, key, asked } = await follow();
    daemon.push(frame(4, { type: "message.delta", text: "palavra " }));
    daemon.push(frame(3, said(3).event));
    daemon.push(frame(5, said(5).event));
    daemon.streams.s1?.push(said(5));
    await settle(() => store.getState().sessions[key]?.lastSeq === 5);
    expect(store.getState().sessions[key]?.lastSeq).toBe(5);
    expect(asked()).toEqual([0]);
  });

  test("when the daemon cannot fill the gap, the app asks once, not over and over", async () => {
    const { store, daemon, key, asked } = await follow();
    // Seq 5 is gone for good (a retention that cut it): 6 and 7 keep arriving.
    daemon.push(frame(6, said(6).event));
    await settle(() => asked().length === 2);
    daemon.push(frame(7, said(7).event));
    daemon.push(frame(8, said(8).event));
    await Bun.sleep(300);
    expect(asked()).toEqual([0, 4]);
    expect(store.getState().sessions[key]?.lastSeq).toBe(4);
  });

  test("an app that is online again after a gap goes on from its last seq like any reconnect", async () => {
    const { store, daemon, key, asked } = await follow();
    daemon.push(frame(6, said(6).event));
    await settle(() => asked().length === 2);
    daemon.streams.s1?.push(said(5), said(6), said(7));
    daemon.push(frame(7, said(7).event));
    await settle(() => store.getState().sessions[key]?.lastSeq === 7);
    expect(store.getState().sessions[key]?.items.map((item) => item.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
