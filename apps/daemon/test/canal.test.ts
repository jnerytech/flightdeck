import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CHANNEL_INSTRUCTIONS, startChannel } from "../src/central/channel.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { startReceptor } from "../src/central/receptor.ts";
import { runCli } from "../src/main.ts";
import { EventStore } from "../src/store/event-store.ts";
import { poll } from "./helpers.ts";

const TOKEN = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const store = new EventStore(":memory:");
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const receptor = startReceptor({ port: 0, token: () => TOKEN, external, isManaged: () => false });
  cleanups.push(() => receptor.stop());
  external.apply("SessionStart", { session_id: "s1", cwd: "/p", launch_id: "L1" });
  return { external, receptor };
}

/** The MCP client side (what `claude` is), linked in memory to the channel server. */
async function claude() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claude-de-teste", version: "0.0.0" });
  const notifications: Array<{ method: string; params?: unknown }> = [];
  client.fallbackNotificationHandler = async (notification) => {
    notifications.push(notification);
  };
  return { client, clientSide, serverSide, notifications };
}

describe("canal", () => {
  test("declara claude/channel, nenhuma ferramenta, e instruções que tratam a mensagem como prompt", async () => {
    const { receptor } = setup();
    const { client, clientSide, serverSide } = await claude();
    const channel = await startChannel({
      launchId: "L1",
      url: receptor.url,
      token: TOKEN,
      transport: serverSide,
    });
    cleanups.push(() => channel.close());
    await client.connect(clientSide);
    const capabilities = client.getServerCapabilities();
    expect(capabilities?.experimental).toEqual({ "claude/channel": {} });
    expect(capabilities?.tools).toBeUndefined();
    expect(client.getInstructions()).toBe(CHANNEL_INSTRUCTIONS);
    expect(CHANNEL_INSTRUCTIONS).toContain("Flightdeck");
    const tools = await client.listTools().then(
      () => "listou",
      () => "recusou",
    );
    expect(tools).toBe("recusou");
  });

  test("se liga à sessão pelo launch id e transforma cada mensagem em notifications/claude/channel", async () => {
    const { receptor, external } = setup();
    const { client, clientSide, serverSide, notifications } = await claude();
    const channel = await startChannel({
      launchId: "L1",
      url: receptor.url,
      token: TOKEN,
      transport: serverSide,
    });
    cleanups.push(() => channel.close());
    await client.connect(clientSide);
    expect(await poll(() => external.get("s1")?.controllable)).toBe(true);
    expect(receptor.sendToLaunch("L1", "rode os testes")).toBe(true);
    expect(receptor.sendToLaunch("outro", "x")).toBe(false);
    expect(await poll(() => notifications[0])).toEqual({
      method: "notifications/claude/channel",
      params: { content: "rode os testes", meta: { from: "flightdeck" } },
    });
    await channel.close();
    expect(await poll(() => external.get("s1")?.controllable === false)).toBe(true);
  });

  test("conexão sem token, ou com token errado, é recusada", async () => {
    const { receptor, external } = setup();
    const raw = new WebSocket(`${receptor.url.replace("http", "ws")}/channel?launch=L1`);
    const outcome = await new Promise<string>((resolve) => {
      raw.addEventListener("open", () => resolve("abriu"));
      raw.addEventListener("error", () => resolve("recusou"));
    });
    expect(outcome).toBe("recusou");
    const { serverSide } = await claude();
    const wrong = await startChannel({
      launchId: "L1",
      url: receptor.url,
      token: "errado",
      transport: serverSide,
    }).then(
      () => "conectou",
      () => "recusou",
    );
    expect(wrong).toBe("recusou");
    expect(external.get("s1")?.controllable).toBe(false);
  });

  test("flightdeckd channel liga o servidor MCP ao transporte e sai quando o claude fecha", async () => {
    const { receptor, external } = setup();
    const { client, clientSide, serverSide } = await claude();
    let code = null as number | null;
    await runCli(["channel", "--launch", "L1", "--url", receptor.url, "--token", TOKEN], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      channelTransport: serverSide,
    });
    // Still running: it serves until claude closes the transport.
    expect(code).toBeNull();
    await client.connect(clientSide);
    expect(await poll(() => external.get("s1")?.controllable)).toBe(true);
    await client.close();
    expect(await poll(() => code === 0)).toBe(true);
    expect(await poll(() => external.get("s1")?.controllable === false)).toBe(true);
  });

  test("flightdeckd channel sem receptor no ar sai com erro claro", async () => {
    const { serverSide } = await claude();
    const out: string[] = [];
    let code = null as number | null;
    await runCli(["channel", "--launch", "L1", "--url", "http://127.0.0.1:1", "--token", TOKEN], {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      channelTransport: serverSide,
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("canal do Flightdeck");
  });
});
