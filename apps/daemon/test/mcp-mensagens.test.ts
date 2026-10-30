import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "../src/main.ts";
import { Idle } from "../src/messaging/idle.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { type FakeEndpoints, PROJECT, setup } from "./mensagens-helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "mcp-msg-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon with the messaging service, and `flightdeckd mcp` as the session `env` says it is. */
async function boot(env: Record<string, string> = { FLIGHTDECK_SESSION: "s1" }) {
  const base = setup();
  const idle = new Idle({
    endpoints: base.endpoints,
    messaging: base.messaging,
    host: "pc",
    clock: () => base.now.at,
  });
  const { manager } = newManager();
  const server = startServer({
    manager,
    messaging: base.messaging,
    idle,
    hostName: "pc",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => {
    server.stop();
    idle.stop();
    base.messaging.stop();
  });
  base.endpoints.add("s1", { name: "coordenadora" });
  base.endpoints.add("s2", { name: "executora", persona: "qa", state: "running" });
  base.endpoints.add("s3", { projectKey: "github.com/acme/outro" });
  base.endpoints.add("T1", { kind: "terminal" });
  base.endpoints.launches.set("launch-1", "T1");

  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runCli(["mcp", "--config", file], {
    env,
    log: { log: () => {}, error: () => {} },
    exit: () => {},
    onSignal: () => {},
    mcpTransport: serverSide,
  });
  const client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(clientSide);
  cleanups.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
      return result.isError ? { error: text } : { data: JSON.parse(text) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
  return { ...base, idle, client, call, endpoints: base.endpoints as FakeEndpoints };
}

describe("mcp-mensagens", () => {
  test("list_sessions mostra as sessões que esta pode ver, com nome, host, persona, estado, projeto e se recebe", async () => {
    const { call } = await boot();
    const listed = await call("list_sessions");
    expect(listed.data?.sessions.map((s: { address: string }) => s.address).sort()).toEqual([
      "pc/T1",
      "pc/s2",
    ]);
    expect(listed.data?.sessions.find((s: { id: string }) => s.id === "s2")).toMatchObject({
      name: "executora",
      host: "pc",
      persona: "qa",
      state: "running",
      projectKey: PROJECT,
      receives: true,
    });
    // The session of another project is not there at all.
    expect(JSON.stringify(listed)).not.toContain("s3");
  });

  test("send_to_session devolve entregue, na fila ou a recusa com o motivo", async () => {
    const { call, endpoints } = await boot();
    expect((await call("send_to_session", { to: "pc/T1", text: "oi" })).data).toMatchObject({
      resultado: "entregue",
    });
    endpoints.busy.add("s2");
    expect((await call("send_to_session", { to: "pc/s2", text: "depois" })).data).toMatchObject({
      resultado: "na fila",
    });
    const refused = await call("send_to_session", { to: "pc/s3", text: "oi" });
    expect(refused.data).toMatchObject({ resultado: "recusada" });
    expect(refused.data?.motivo).toContain("projeto");
    expect(endpoints.sent.map((s) => s.id)).toEqual(["T1", "s2"]);
    expect(endpoints.sent[0]?.text).toContain("[id para responder: pc/s1]");
  });

  test("notify_when_idle avisa uma vez só quando a sessão termina o turno, e já avisa se ela está ociosa", async () => {
    const { call, endpoints } = await boot();
    expect((await call("notify_when_idle", { session: "pc/s2" })).data).toEqual({ avisado: false });
    endpoints.setState("s2", "idle");
    expect(endpoints.sent).toHaveLength(1);
    expect(endpoints.sent[0]?.id).toBe("s1");
    endpoints.setState("s2", "running");
    endpoints.setState("s2", "idle");
    expect(endpoints.sent).toHaveLength(1);
    expect((await call("notify_when_idle", { session: "pc/s2" })).data).toEqual({ avisado: true });
    expect(endpoints.sent).toHaveLength(2);
    expect((await call("notify_when_idle", { session: "pc/s3" })).error).toContain("projeto");
  });

  test("read_session é só leitura: o resumo e as últimas mensagens, e o que as regras escondem não se lê", async () => {
    const { call, endpoints } = await boot();
    endpoints.transcripts.set("s2", {
      summary: { request: "faça x", state: "running", tool: null, since: null },
      messages: [
        { role: "user", text: "faça x" },
        { role: "assistant", text: "feito" },
      ],
    });
    expect((await call("read_session", { session: "pc/s2", last: 1 })).data).toMatchObject({
      messages: [{ role: "assistant", text: "feito" }],
      summary: { request: "faça x" },
    });
    expect((await call("read_session", { session: "pc/s3" })).error).toContain("projeto");
    expect(endpoints.sent).toEqual([]);
  });

  test("o terminal é identificado pelo lançamento (FLIGHTDECK_LAUNCH_ID)", async () => {
    const { call, endpoints } = await boot({ FLIGHTDECK_LAUNCH_ID: "launch-1" });
    expect(
      (await call("send_to_session", { to: "pc/s2", text: "do terminal" })).data,
    ).toMatchObject({ resultado: "entregue" });
    expect(endpoints.sent[0]?.text).toContain("[id para responder: pc/T1]");
  });

  test("sem saber qual é a sessão, nenhuma ferramenta de mensagem funciona, e diz por quê", async () => {
    const { call, endpoints } = await boot({});
    for (const [name, args] of [
      ["list_sessions", {}],
      ["send_to_session", { to: "pc/s2", text: "oi" }],
      ["notify_when_idle", { session: "pc/s2" }],
      ["read_session", { session: "pc/s2" }],
    ] as const) {
      const result = await call(name, args);
      expect(result.error).toContain("FLIGHTDECK_SESSION");
    }
    expect(endpoints.sent).toEqual([]);
  });
});
