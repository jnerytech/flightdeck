import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startChannel } from "../src/central/channel.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { ExternalPermissions } from "../src/central/external-permissions.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "app-token-0123456789abcdef";
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const { manager, store } = newManager();
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const permissions = new ExternalPermissions();
  const receptor = startReceptor({ port: 0, token: () => HOOKS, external, isManaged: () => false });
  cleanups.push(() => receptor.stop());
  const server = startServer({
    manager,
    central: { external, permissions, receptor },
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  return { external, receptor, server };
}

/** A `claude` with the channel of `launchId` connected; collects what reaches it. */
async function claudeWithChannel(url: string, launchId: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claude-de-teste", version: "0.0.0" });
  const received: string[] = [];
  client.fallbackNotificationHandler = async (n) => {
    received.push(String((n.params as { content?: unknown } | undefined)?.content));
  };
  const channel = await startChannel({ launchId, url, token: HOOKS, transport: serverSide });
  cleanups.push(() => channel.close());
  await client.connect(clientSide);
  return received;
}

async function app(url: string): Promise<FrameClient> {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

describe("mensagem-externa", () => {
  test("external.message chega ao canal certo", async () => {
    const { external, receptor, server } = setup();
    external.apply("SessionStart", { session_id: "s1", cwd: "/p", launch_id: "L1" });
    external.apply("SessionStart", { session_id: "s2", cwd: "/q", launch_id: "L2" });
    const first = await claudeWithChannel(receptor.url, "L1");
    const second = await claudeWithChannel(receptor.url, "L2");
    await poll(() => external.get("s1")?.controllable && external.get("s2")?.controllable);
    const client = await app(server.url);
    const ack = await client.request("external.message", {
      claudeSessionId: "s2",
      text: "só pra s2",
    });
    expect(ack.ok).toBe(true);
    expect(await poll(() => second[0])).toBe("só pra s2");
    expect(first).toEqual([]);
  });

  test("sessão sem canal é recusada com erro claro; sessão desconhecida é not_found", async () => {
    const { external, server } = setup();
    external.apply("SessionStart", { session_id: "s3", cwd: "/p" });
    const client = await app(server.url);
    const refused = await client.request("external.message", { claudeSessionId: "s3", text: "oi" });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(JSON.stringify(refused)).toContain("flightdeckd claude");
    const missing = await client.request("external.message", { claudeSessionId: "s9", text: "oi" });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
