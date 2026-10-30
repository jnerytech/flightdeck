import { afterEach, describe, expect, test } from "bun:test";
import { Command, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "@flightdeck/protocol";
import { AgentConfig } from "../src/agentcfg/files.ts";
import { McpConfig } from "../src/agentcfg/mcp.ts";
import { Forker } from "../src/checkpoints/fork.ts";
import { Rewinder } from "../src/checkpoints/rewind.ts";
import { Snapshots } from "../src/checkpoints/snapshots.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newBoard } from "./board-helpers.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "compat-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function serve(extra: Partial<Parameters<typeof startServer>[0]> = {}) {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...extra,
  });
  cleanups.push(() => server.stop());
  return server;
}

/** Raw socket: what comes back to a hello, and the close code of what follows. */
async function hello(url: string, payload: Record<string, unknown>) {
  const ws = new WebSocket(url);
  cleanups.push(() => ws.close());
  const frames: Array<Record<string, unknown>> = [];
  let closed: number | null = null;
  ws.addEventListener("message", (m) => frames.push(JSON.parse(String(m.data))));
  ws.addEventListener("close", (e) => {
    closed = e.code;
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.send(
    JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t", ...payload } }),
  );
  const deadline = Date.now() + 2000;
  while (frames.length === 0 && Date.now() < deadline) await Bun.sleep(5);
  return { ack: frames[0], ws, closed: () => closed };
}

describe("protocolo-compat", () => {
  test("o protocolo continua 1, com mínimo 1", () => {
    expect([MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]).toEqual([1, 1]);
    const parsed = Command.safeParse({
      id: "1",
      type: "hello",
      payload: { token: "t", client: "c", protocolVersion: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  test("hello sem versão vale 1 e autentica; com a versão atual também", async () => {
    const server = serve();
    for (const payload of [{}, { protocolVersion: 1 }]) {
      const { ack } = await hello(server.url, payload);
      expect(ack).toMatchObject({ type: "ack", ok: true, data: { protocolVersion: 1 } });
    }
  });

  test("versão fora do intervalo dá protocol_incompatible com as duas versões e não autentica", async () => {
    const server = serve();
    for (const version of [999, 0]) {
      const { ack, ws, closed } = await hello(server.url, { protocolVersion: version });
      expect(ack).toMatchObject({ ok: false, error: { code: "protocol_incompatible" } });
      const message = String((ack?.error as { message?: string } | undefined)?.message);
      expect(message).toContain(String(version));
      expect(message).toContain("[1, 1]");
      // Still not authenticated: anything but a hello closes it.
      ws.send(JSON.stringify({ id: "2", type: "host.info", payload: {} }));
      const deadline = Date.now() + 2000;
      while (closed() === null && Date.now() < deadline) await Bun.sleep(5);
      expect(closed()).toBe(4401);
    }
  });

  test("um daemon com outro intervalo recusa o cliente de versão 1", async () => {
    const server = serve({ protocolRange: [2, 3] });
    const { ack } = await hello(server.url, {});
    expect(ack).toMatchObject({ ok: false, error: { code: "protocol_incompatible" } });
    expect(String((ack?.error as { message?: string } | undefined)?.message)).toContain("[2, 3]");
  });

  test("host.info traz os recursos do daemon", async () => {
    const plain = new FrameClient(serve().url);
    cleanups.push(() => plain.close());
    await plain.request("hello", { token: TOKEN, client: "t" });
    expect((await plain.data<{ features: string[] }>("host.info", {}))?.features).toEqual([]);
    const { board, manager } = newBoard();
    cleanups.push(() => board.stop());
    const full = serve({ manager, board, features: undefined });
    const client = new FrameClient(full.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toEqual([
      "workflows",
      "rules",
    ]);
    const custom = new FrameClient(serve({ features: ["central", "maintenance"] }).url);
    cleanups.push(() => custom.close());
    await custom.request("hello", { token: TOKEN, client: "t" });
    expect((await custom.data<{ features: string[] }>("host.info", {}))?.features).toEqual([
      "central",
      "maintenance",
    ]);
  });

  test("host.info anuncia checkpoints e agentcfg só quando as peças estão ligadas", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const { manager } = newManager({ store });
    const snapshots = new Snapshots({ db: store.db });
    const rewinder = new Rewinder({ snapshots, sessions: manager });
    const forker = new Forker({ runtime: new FakeRuntime(), manager, rewinder });
    const featuresOf = async (extra: Partial<Parameters<typeof startServer>[0]>) => {
      const client = new FrameClient(serve({ features: undefined, ...extra }).url);
      cleanups.push(() => client.close());
      await client.request("hello", { token: TOKEN, client: "t" });
      return (await client.data<{ features: string[] }>("host.info", {}))?.features;
    };
    expect(await featuresOf({ snapshots, rewinder, forker })).toEqual(["checkpoints"]);
    expect(await featuresOf({ snapshots, rewinder })).toEqual([]);
    expect(await featuresOf({ agentcfg: new AgentConfig(), mcp: new McpConfig() })).toEqual([
      "agentcfg",
    ]);
    expect(await featuresOf({ agentcfg: new AgentConfig() })).toEqual([]);
  });
});
