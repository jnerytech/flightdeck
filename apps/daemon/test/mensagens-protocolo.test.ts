import { afterEach, describe, expect, test } from "bun:test";
import { Idle } from "../src/messaging/idle.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { PROJECT, setup } from "./mensagens-helpers.ts";

const TOKEN = "mensagens-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function boot(options: { messaging?: boolean } = {}) {
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
    ...(options.messaging === false ? {} : { messaging: base.messaging, idle }),
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
  base.endpoints.add("s1", { name: "uma" });
  base.endpoints.add("s2", { name: "outra", state: "running" });
  base.endpoints.busy.add("s2");
  base.endpoints.add("s3", { projectKey: "github.com/acme/outro" });
  return { ...base, idle, server };
}

async function connect(url: string) {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

describe("mensagens-protocolo", () => {
  test("sem o serviço de mensagens o daemon responde invalid_state", async () => {
    const { server } = boot({ messaging: false });
    const client = await connect(server.url);
    for (const [type, payload] of [
      ["messages.send", { as: { session: "s1" }, to: "s2", text: "oi" }],
      ["messages.list", {}],
      ["messages.sessions", { as: { session: "s1" } }],
      ["messages.read", { as: { session: "s1" }, session: "s2" }],
      ["messages.relay", { message: {} }],
      ["messages.relayed", { id: "m", status: "queued" }],
      ["messages.peers", { host: "wsl", sessions: [] }],
      ["messages.watch", {}],
      ["idle.subscribe", { as: { session: "s1" }, session: "s2" }],
      ["messaging.rules.get", {}],
      ["messaging.rules.set", { policy: {} }],
    ] as const) {
      const ack = await client.request(type, payload);
      expect(ack).toMatchObject({ ok: false });
    }
  });

  test("enviar, listar, ver as sessões e ler, e a recusa por regra é um resultado, não um erro do protocolo", async () => {
    const { server, endpoints } = boot();
    const client = await connect(server.url);
    endpoints.transcripts.set("s2", {
      summary: { request: "faça x", state: "running", tool: null, since: null },
      messages: [{ role: "user", text: "faça x" }],
    });
    expect(
      await client.data("messages.send", { as: { session: "s1" }, to: "pc/s2", text: "oi" }),
    ).toMatchObject({ status: "queued", reason: null });
    expect(
      await client.data("messages.send", { as: { session: "s1" }, to: "pc/s3", text: "oi" }),
    ).toMatchObject({ status: "refused" });
    const listed = await client.data<{ messages: Array<{ status: string }> }>("messages.list", {});
    expect(listed?.messages.map((m) => m.status).sort()).toEqual(["queued", "refused"]);
    expect(
      (
        await client.data<{ sessions: Array<{ id: string }> }>("messages.sessions", {
          as: { session: "s1" },
        })
      )?.sessions.map((s) => s.id),
    ).toEqual(["s2"]);
    expect(
      await client.data("messages.read", { as: { session: "s1" }, session: "pc/s2", last: 5 }),
    ).toMatchObject({ messages: [{ role: "user", text: "faça x" }] });
    expect(
      await client.request("messages.read", { as: { session: "s1" }, session: "pc/s3" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(
      await client.request("messages.send", { as: { session: "fantasma" }, to: "s2", text: "oi" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await client.request("messages.send", { as: {}, to: "s2", text: "oi" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("quem assiste recebe as mudanças das mensagens, o repasse entre hosts e o aviso de ocioso", async () => {
    const { server, endpoints } = boot();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await app.request("messages.watch", {});
    await claude.data("messages.send", { as: { session: "s1" }, to: "pc/s2", text: "oi" });
    expect(
      await poll(() => app.frames.find((f) => f.type === "messages.updated"), 2000),
    ).toMatchObject({
      message: { toSession: "s2", status: "queued" },
    });

    await app.request("messages.peers", {
      host: "wsl",
      sessions: [
        {
          id: "w1",
          name: "w1",
          persona: null,
          projectKey: PROJECT,
          teamId: null,
          state: "idle",
          kind: "managed",
          receives: true,
          reason: null,
        },
      ],
    });
    const sent = await claude.data<{ id: string }>("messages.send", {
      as: { session: "s1" },
      to: "wsl/w1",
      text: "do PC",
    });
    const relay = await poll(() => app.frames.find((f) => f.type === "messages.relay"), 2000);
    expect(relay).toMatchObject({ message: { id: sent?.id, toHost: "wsl", text: "do PC" } });
    await app.request("messages.relayed", { id: sent?.id, status: "delivered" });
    expect(
      (
        await claude.data<{ messages: Array<{ id: string; status: string }> }>("messages.list", {})
      )?.messages.find((m) => m.id === sent?.id)?.status,
    ).toBe("delivered");

    expect(
      await claude.data("idle.subscribe", { as: { session: "s1" }, session: "pc/s2" }),
    ).toEqual({ fired: false });
    endpoints.setState("s2", "idle");
    expect(await poll(() => app.frames.find((f) => f.type === "idle.fired"), 2000)).toMatchObject({
      watcher: "pc/s1",
      session: "pc/s2",
    });
    expect(
      await claude.request("idle.subscribe", { as: { session: "s1" }, session: "pc/s3" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("o repasse chega ao outro daemon pelo comando messages.relay, e o laço aparece como alerta", async () => {
    const { server, endpoints } = boot();
    const app = await connect(server.url);
    await app.request("messages.watch", {});
    const result = await app.data("messages.relay", {
      message: {
        id: "m1",
        from: {
          id: "x1",
          host: "wsl",
          name: "x",
          persona: null,
          projectKey: PROJECT,
          teamId: null,
        },
        toSession: "s1",
        toHost: "pc",
        text: "de lá",
        createdAt: "2026-10-28T12:00:00.000Z",
        untrusted: false,
        kind: "session",
      },
    });
    expect(result).toMatchObject({ id: "m1", status: "delivered" });
    expect(endpoints.sent[0]?.text).toContain("de lá");
    // Ping-pong until the loop detector pauses the pair.
    for (let i = 0; i < 12; i++) {
      const [from, to] = i % 2 === 0 ? ["s1", "s2"] : ["s2", "s1"];
      await app.data("messages.send", { as: { session: from }, to: `pc/${to}`, text: `m${i}` });
    }
    const alert = await poll(() => app.frames.find((f) => f.type === "messaging.alert"), 2000);
    expect(alert).toMatchObject({ kind: "loop" });
  });

  test("a política: ler, trocar, recusar a inválida e liberar o par pausado", async () => {
    const { server } = boot();
    const client = await connect(server.url);
    expect(await client.data("messaging.rules.get", {})).toMatchObject({
      policy: { perPairPerHour: 20, perSessionPerHour: 100 },
      paused: [],
    });
    expect(
      await client.data("messaging.rules.set", { policy: { perPairPerHour: 5 } }),
    ).toMatchObject({ policy: { perPairPerHour: 5 } });
    expect(
      await client.request("messaging.rules.set", { policy: { perPairPerHour: 0 } }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(
      await client.data("messaging.rules.set", {
        policy: {
          exceptions: [
            { id: "e1", from: { session: "s1" }, to: { project: "github.com/acme/outro" } },
          ],
        },
      }),
    ).toMatchObject({ policy: { exceptions: [{ id: "e1" }] } });
    expect(
      await client.data("messages.send", { as: { session: "s1" }, to: "pc/s3", text: "agora vai" }),
    ).toMatchObject({ status: "delivered" });
  });
});
