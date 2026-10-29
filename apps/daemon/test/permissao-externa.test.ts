import { afterEach, describe, expect, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import { ExternalPermissions, summarizeInput } from "../src/central/external-permissions.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
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
  const receptor = startReceptor({
    port: 0,
    token: () => HOOKS,
    external,
    permissions,
    isManaged: () => false,
  });
  cleanups.push(() => receptor.stop());
  const server = startServer({
    manager,
    central: { external, permissions },
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  return { external, permissions, receptor, server };
}

async function app(url: string, watch = true): Promise<FrameClient> {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  if (watch) expect((await client.request("external.watch", {})).ok).toBe(true);
  return client;
}

/** Posts a hook without waiting: a held PermissionRequest only answers later. */
function post(
  receptor: Receptor,
  event: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return fetch(`${receptor.url}/hooks/${event}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HOOKS}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: "s1", hook_event_name: event, ...body }),
    ...(signal ? { signal } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.text() }));
}

const REQUEST = {
  tool_name: "Write",
  tool_input: { file_path: "a.txt", content: "x".repeat(500) },
  permission_suggestions: [],
};

type Frame = Record<string, unknown>;
const permissionFrames = (client: FrameClient) =>
  client.frames.filter((f) => f.type === "external.permission") as Frame[];
const openFrame = (client: FrameClient) =>
  poll(() => permissionFrames(client).find((f) => f.state === "open"));
const closedFrame = (client: FrameClient, requestId: unknown) =>
  poll(() =>
    permissionFrames(client).find((f) => f.state === "closed" && f.requestId === requestId),
  );

describe("permissao-externa", () => {
  test("sem app conectado (nenhum external.watch), a resposta é vazia na hora", async () => {
    const { receptor, server, external } = setup();
    await app(server.url, false);
    await post(receptor, "SessionStart", { cwd: "/p" });
    expect(await post(receptor, "PermissionRequest", REQUEST)).toEqual({ status: 200, body: "" });
    expect(external.get("s1")?.status).toBe("awaiting_permission");
  });

  test("com app, segura, publica na fila e devolve o JSON de allow", async () => {
    const { receptor, server } = setup();
    const client = await app(server.url);
    await post(receptor, "SessionStart", { cwd: "/p" });
    const answer = post(receptor, "PermissionRequest", REQUEST);
    const open = await openFrame(client);
    expect(open).toMatchObject({
      type: "external.permission",
      claudeSessionId: "s1",
      toolName: "Write",
      state: "open",
    });
    expect(String(open?.requestId).startsWith("ext-")).toBe(true);
    const input = open?.input as Record<string, string>;
    expect(input.file_path).toBe("a.txt");
    expect(input.content?.length).toBeLessThan(300);
    const ack = await client.request("permission.respond", {
      requestId: open?.requestId,
      decision: "allow",
    });
    expect(ack.ok).toBe(true);
    expect(JSON.parse((await answer).body)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect(await closedFrame(client, open?.requestId)).toMatchObject({ resolution: "allow" });
  });

  test("deny devolve o JSON de deny com a mensagem", async () => {
    const { receptor, server } = setup();
    const client = await app(server.url);
    const answer = post(receptor, "PermissionRequest", REQUEST);
    const open = await openFrame(client);
    await client.request("permission.respond", {
      requestId: open?.requestId,
      decision: "deny",
      message: "agora não",
    });
    expect(JSON.parse((await answer).body)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "agora não" },
      },
    });
  });

  test("conexão do hook caída tira o pedido da fila", async () => {
    const { receptor, server, permissions } = setup();
    const client = await app(server.url);
    const abort = new AbortController();
    const answer = post(receptor, "PermissionRequest", REQUEST, abort.signal).catch(() => "caiu");
    const open = await openFrame(client);
    abort.abort();
    expect(await answer).toBe("caiu");
    expect(await closedFrame(client, open?.requestId)).toMatchObject({ resolution: "dropped" });
    expect(permissions.open()).toEqual([]);
  });

  test("evento posterior da sessão (resposta no terminal) tira o pedido; o aviso de permissão não", async () => {
    const { receptor, server } = setup();
    const client = await app(server.url);
    const answer = post(receptor, "PermissionRequest", REQUEST);
    const open = await openFrame(client);
    await post(receptor, "Notification", { notification_type: "permission_prompt" });
    expect(permissionFrames(client).filter((f) => f.state === "closed")).toEqual([]);
    await post(receptor, "PostToolUse", { tool_name: "Write" });
    expect(await answer).toEqual({ status: 200, body: "" });
    expect(await closedFrame(client, open?.requestId)).toMatchObject({
      resolution: "answered_elsewhere",
    });
  });

  test("external.watch começa com as sessões vivas e os pedidos abertos", async () => {
    const { receptor, server } = setup();
    const first = await app(server.url);
    await post(receptor, "SessionStart", { cwd: "/p" });
    void post(receptor, "PermissionRequest", REQUEST);
    const open = await openFrame(first);
    const late = await app(server.url);
    expect(late.frames.find((f) => f.type === "external.updated")).toMatchObject({
      session: { claudeSessionId: "s1", status: "awaiting_permission" },
    });
    expect(permissionFrames(late)).toEqual([open as Frame]);
    const listed = await late.data<{ sessions: Array<{ claudeSessionId: string }> }>(
      "external.list",
      {},
    );
    expect(listed?.sessions.map((s) => s.claudeSessionId)).toEqual(["s1"]);
    await first.request("permission.respond", { requestId: open?.requestId, decision: "allow" });
  });

  test("permission.respond com id que não é externo segue para as sessões gerenciadas", async () => {
    const { server } = setup();
    const client = await app(server.url);
    const ack = await client.request("permission.respond", { requestId: "r-1", decision: "allow" });
    expect(ack).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("ao parar, os pedidos segurados recebem resposta vazia", async () => {
    const { receptor, server, permissions } = setup();
    await app(server.url);
    const answer = post(receptor, "PermissionRequest", REQUEST);
    await poll(() => permissions.open().length > 0);
    permissions.closeAll();
    expect(await answer).toEqual({ status: 200, body: "" });
  });

  test("a entrada resumida corta textos longos e mantém o resto", () => {
    expect(summarizeInput({ a: "y".repeat(1000), b: 2, c: { d: 1 } })).toEqual({
      a: `${"y".repeat(200)}…`,
      b: 2,
      c: { d: 1 },
    });
  });
});
