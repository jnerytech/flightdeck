import { afterEach, describe, expect, test } from "bun:test";
import { AppStore, needsYou, sessionKey } from "../src/lib/app-store.ts";
import { HOSTS_KEY } from "../src/lib/hosts.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup(focused = false) {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform(focused);
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  return { ...d, server, ...mem, store };
}

const host = (store: AppStore, id: string) => store.getState().hosts.find((h) => h.id === id);

describe("desktop: estado do app", () => {
  test("adicionar host guarda o token na plataforma, conecta e cria sessão", async () => {
    const { store, server, items, platform, project } = setup();
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    expect(await platform.secrets.get(hostId)).toBe(TOKEN);
    expect(items.get(HOSTS_KEY)).not.toContain(TOKEN);
    await waitFor(() => host(store, hostId)?.status === "online", "online");
    expect(host(store, hostId)?.info?.allowedRoots).toHaveLength(1);

    const sessionId = await store.createSession(hostId, { cwd: project, prompt: "oi", name: "s1" });
    expect(sessionId).toBeTruthy();
    expect(store.getState().selected).toEqual({ hostId, sessionId: sessionId as string });
    const key = sessionKey(hostId, sessionId as string);
    await waitFor(() => store.getState().sessions[key]?.status === "idle", "idle");
    expect(host(store, hostId)?.sessions.map((s) => s.name)).toEqual(["s1"]);
    expect(host(store, hostId)?.sessions[0]?.status).toBe("idle");

    await store.send("de novo");
    await waitFor(
      () => store.getState().sessions[key]?.items.filter((i) => i.kind === "result").length === 2,
      "segundo turno",
    );
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
  });

  test("permissão notifica fora de foco; allow e deny respondem pelo card", async () => {
    const { store, server, project, notifications } = setup(false);
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => host(store, hostId)?.status === "online");
    const sessionId = (await store.createSession(hostId, {
      cwd: project,
      prompt: "[tool]",
    })) as string;
    const key = sessionKey(hostId, sessionId);
    const pending = await waitFor(() => store.getState().sessions[key]?.pending[0], "pedido");
    expect(notifications.map((n) => n.title)).toContain("pc · p: esperando você");
    await store.respond(pending, "allow");
    await waitFor(() => store.getState().sessions[key]?.status === "idle");
    expect(notifications.map((n) => n.title)).toContain("pc · p: turno concluído");

    await store.send("[tool] de novo");
    const second = await waitFor(
      () => store.getState().sessions[key]?.pending[0],
      "segundo pedido",
    );
    await store.respond(second, "deny", "não");
    await waitFor(() => store.getState().sessions[key]?.status === "idle");
    const results = Object.values(store.getState().sessions[key]?.toolResults ?? {});
    expect(results.some((r) => r.isError && r.content === "não")).toBe(true);
  });

  test("estado inicial não notifica e janela em foco também não", async () => {
    const d = setup(true);
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "[tool]" });
    await waitFor(() => d.manager.get(sessionId).status === "awaiting_permission");

    const unfocused = memoryPlatform(false);
    const late = new AppStore(unfocused.platform, { baseDelayMs: 10 });
    cleanups.push(() => late.dispose());
    await late.addHost({ name: "pc", url: d.server.url, token: TOKEN });
    const [request] = await waitFor(
      () => needsYou(late.getState()).length === 1 && needsYou(late.getState()),
      "pedido aberto",
    );
    expect(unfocused.notifications).toEqual([]);

    await d.store.addHost({ name: "pc", url: d.server.url, token: TOKEN });
    await waitFor(() => needsYou(d.store.getState()).length === 1);
    d.manager.respondPermission({ requestId: request?.requestId ?? "", decision: "allow" });
    await waitFor(
      () =>
        needsYou(late.getState()).length === 0 &&
        late.getState().hosts[0]?.sessions[0]?.status === "idle",
    );
    await waitFor(() => d.store.getState().hosts[0]?.sessions[0]?.status === "idle");
    expect(d.notifications).toEqual([]);
    expect(unfocused.notifications.map((n) => n.title)).toEqual(["pc · p: turno concluído"]);
  });

  test("interrupt, close e resume pela sessão selecionada", async () => {
    const { store, server, project } = setup();
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => host(store, hostId)?.status === "online");
    const sessionId = (await store.createSession(hostId, {
      cwd: project,
      prompt: "[tool]",
    })) as string;
    const key = sessionKey(hostId, sessionId);
    await waitFor(() => store.getState().sessions[key]?.pending.length === 1);
    await store.interrupt();
    await waitFor(() => store.getState().sessions[key]?.status === "idle", "idle após interrupt");
    await store.close();
    await waitFor(() => store.getState().sessions[key]?.status === "ended", "ended");
    await store.resume();
    await waitFor(() => store.getState().sessions[key]?.status === "idle", "retomada");
  });

  test("erros viram mensagem no estado; sem seleção as ações não fazem nada", async () => {
    const { store, server } = setup();
    await store.send("x");
    await store.interrupt();
    await store.respond("r", "allow");
    expect(store.getState().error).toBeNull();
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => host(store, hostId)?.status === "online");
    expect(await store.createSession(hostId, { cwd: "/nao/existe", prompt: "x" })).toBeNull();
    expect(store.getState().error).toContain("forbidden_cwd");
    store.clearError();
    expect(store.getState().error).toBeNull();
    expect(await store.createSession("host-inexistente", { cwd: "/", prompt: "x" })).toBeNull();
    expect(store.getState().error).toContain("host");
    store.select(hostId, "sessao-fantasma");
    await store.send("x");
    expect(store.getState().error).toContain("not_found");
  });

  test("init recarrega hosts salvos; host sem token fica offline; remover limpa tudo", async () => {
    const { server, platform, items, project } = setup();
    platform.storage.setItem(
      HOSTS_KEY,
      JSON.stringify([
        { id: "a", name: "com token", url: server.url },
        { id: "b", name: "sem token", url: server.url },
      ]),
    );
    await platform.secrets.set("a", TOKEN);
    const store = new AppStore(platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    await store.init();
    await waitFor(() => host(store, "a")?.status === "online", "host a online");
    expect(host(store, "b")?.status).toBe("offline");
    const sessionId = (await store.createSession("a", { cwd: project, prompt: "oi" })) as string;
    await waitFor(() => store.getState().sessions[sessionKey("a", sessionId)]?.status === "idle");
    store.select("a", null);
    await store.removeHost("a");
    expect(host(store, "a")).toBeUndefined();
    expect(await platform.secrets.get("a")).toBeNull();
    expect(store.getState().selected).toBeNull();
    expect(store.getState().sessions).toEqual({});
    expect(JSON.parse(items.get(HOSTS_KEY) ?? "[]").map((h: { id: string }) => h.id)).toEqual([
      "b",
    ]);
  });

  test("reconexão limpa o texto parcial da sessão aberta", async () => {
    const { store, server, project } = setup();
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => host(store, hostId)?.status === "online");
    const sessionId = (await store.createSession(hostId, { cwd: project, prompt: "oi" })) as string;
    await waitFor(
      () => store.getState().sessions[sessionKey(hostId, sessionId)]?.status === "idle",
    );
    await server.stop();
    await waitFor(() => host(store, hostId)?.status === "connecting", "tentando reconectar");
    expect(store.getState().sessions[sessionKey(hostId, sessionId)]?.streaming).toBe("");
  });

  test("lista de hosts corrompida é ignorada", async () => {
    const { platform } = setup();
    platform.storage.setItem(HOSTS_KEY, "{lixo");
    const store = new AppStore(platform);
    await store.init();
    expect(store.getState().hosts).toEqual([]);
    platform.storage.setItem(HOSTS_KEY, JSON.stringify([{ id: 1 }]));
    await store.init();
    expect(store.getState().hosts).toEqual([]);
    store.dispose();
  });
});
