import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatPairingLink } from "@flightdeck/protocol";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { Router } from "../src/lib/router.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });

/** The confirmation's button with `name` (the dialog is an alertdialog), clicked. */
async function confirmWith(name: string) {
  const dialog = screen.queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  const button = within(dialog as HTMLElement).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
}

/** A host's menu in the sidebar, opened (Radix opens on pointer down). */
async function openHostMenu(host: string) {
  const trigger = screen.queryByRole("button", { name: `Menu de ${host}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const heading = (name: string) => screen.queryByRole("heading", { name }) !== null;

/** A host with a repo project and a card, and a managed session waiting for Bash. */
async function setup() {
  const d = makeDaemon(cleanups);
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const project = await d.board.addProject({ path: repo, promptTemplate: "" });
  const card = d.board.createCard(project.id, { title: "Ajuste", description: "faça" });
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "[bash]", name: "Pedinte" });
  await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  // The request reaches the counter of Precisa de você.
  await settle(() => screen.queryByRole("button", { name: /^Precisa de você ?1$/ }) !== null);
  return { d, store, mem, card, sessionId };
}

describe("navegacao", () => {
  test("rota tipada com pilha: empilhar, voltar, avançar, e empilhar depois de voltar corta a frente", () => {
    const router = new Router();
    const seen: string[] = [];
    router.subscribe(() => seen.push(router.current.name));
    expect(router.current).toEqual({ name: "home" });
    expect(router.canBack).toBe(false);
    router.push({ name: "hub" });
    router.push({ name: "settings" });
    // The same screen again is no new step.
    router.push({ name: "settings" });
    expect(router.canBack).toBe(true);
    router.back();
    expect(router.current).toEqual({ name: "hub" });
    expect(router.canForward).toBe(true);
    router.forward();
    expect(router.current).toEqual({ name: "settings" });
    router.back();
    router.push({ name: "host", host: "h1" });
    expect(router.canForward).toBe(false);
    router.back();
    router.back();
    expect(router.current).toEqual({ name: "home" });
    // Nothing behind the first screen, nothing after the last.
    router.back();
    router.forward();
    router.forward();
    expect(router.current).toEqual({ name: "host", host: "h1" });
    expect(seen).toEqual([
      "hub",
      "settings",
      "hub",
      "settings",
      "hub",
      "host",
      "hub",
      "home",
      "hub",
      "host",
    ]);
  });

  test("abrir um pedido fecha Configurações (sem beco sem saída); Alt+←, Alt+→, botões do mouse e Voltar", async () => {
    await setup();
    await click("Configurações");
    expect(heading("Configurações")).toBe(true);
    // The queue shows the request; "Abrir sessão" opens it (and leaves Settings).
    await sidebar.queueItem("alfa · Pedinte: Bash");
    await click("Abrir sessão");
    expect(heading("Configurações")).toBe(false);
    expect(heading("Pedinte")).toBe(true);

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    });
    expect(heading("Precisa de você")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    });
    expect(heading("Pedinte")).toBe(true);
    // The mouse's back (3) and forward (4) buttons.
    await act(async () => {
      fireEvent.mouseUp(window, { button: 3 });
    });
    expect(heading("Precisa de você")).toBe(true);
    await act(async () => {
      fireEvent.mouseUp(window, { button: 4 });
    });
    expect(heading("Pedinte")).toBe(true);
    // The header's own buttons.
    await click("Voltar");
    expect(heading("Precisa de você")).toBe(true);
    await click("Avançar");
    expect(heading("Pedinte")).toBe(true);
  });

  test("abrir um item fecha a paleta; um deep link de pedido vira rota", async () => {
    const { store, mem, sessionId } = await setup();
    await click("Abrir Sessões");
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(screen.queryByRole("dialog", { name: "Busca global" })).not.toBeNull();
    const requestId =
      store.getState().hosts[0]?.sessions[0]?.pendingPermissions[0]?.requestId ?? "";
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => {
      mem.deepLink(`flightdeck://request?host=${hostId}&request=${requestId}`);
    });
    expect(screen.queryByRole("dialog", { name: "Busca global" })).toBeNull();
    expect(heading("Pedinte")).toBe(true);
    expect(store.router.current).toEqual({
      name: "session",
      host: hostId,
      id: sessionId,
      focus: requestId,
    });
    // A pairing link still only prefills the host form.
    await act(async () => {
      mem.deepLink(
        formatPairingLink({ address: "10.0.0.5", port: 7777, name: "vps", token: TOKEN }),
      );
    });
    expect(store.router.current.name).toBe("add-host");
    expect(
      screen.queryByText("Este link veio de fora do app. Confira os dados antes de salvar."),
    ).not.toBeNull();
    expect(store.getState().hosts).toHaveLength(1);
  });

  test("Iniciar card pelo menu do card no board e pela paleta", async () => {
    const { d, card } = await setup();
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
    await click("Abrir board de repo");
    await settle(() => screen.queryByLabelText("Card Ajuste") !== null);
    const menu = screen.queryByRole("button", { name: "Ações de Ajuste" });
    expect(menu).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(menu as HTMLElement, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    const start = screen.queryByRole("menuitem", { name: "Iniciar card" });
    expect(start).not.toBeNull();
    await act(async () => {
      fireEvent.click(start as HTMLElement);
    });
    await poll(() => d.board.getCard(card.id).runs.length > 0, 8000);
    expect(d.board.getCard(card.id).runs).toHaveLength(1);

    const second = d.board.createCard(card.projectId, { title: "Outro", description: "faça" });
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await settle(() => (screen.queryByRole("dialog")?.textContent ?? "").includes("Outro"));
    await act(async () => {
      fireEvent.change(input as HTMLInputElement, { target: { value: "Outro" } });
    });
    for (const key of ["ArrowDown", "Tab", "ArrowDown"]) {
      await act(async () => {
        fireEvent.keyDown(input as HTMLInputElement, { key });
      });
    }
    const chosen = within(screen.queryByRole("dialog") as HTMLElement)
      .queryAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") === "true");
    expect(chosen?.getAttribute("aria-label")).toBe("Iniciar card");
    await act(async () => {
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    await poll(() => d.board.getCard(second.id).runs.length > 0, 8000);
    expect(d.board.getCard(second.id).runs).toHaveLength(1);
  });

  test("remover o host da tela aberta (nova sessão nele) volta para o hub em vez de uma tela vazia", async () => {
    const alfa = makeDaemon(cleanups);
    const beta = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
      await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts.every((h) => h.status === "online"));
    await sidebar.hostAction("Nova sessão", "beta");
    expect(heading("Nova sessão em beta")).toBe(true);
    await openHostMenu("beta");
    const remove = screen.queryByRole("menuitem", { name: "Remover host" });
    expect(remove).not.toBeNull();
    await act(async () => {
      fireEvent.click(remove as HTMLElement);
    });
    await confirmWith("Remover host");
    expect(store.getState().hosts.map((h) => h.name)).toEqual(["alfa"]);
    expect(heading("Sessões")).toBe(true);
  });

  test("continuar no Flightdeck uma sessão do terminal abre a conversa gerenciada", async () => {
    const d = makeDaemon(cleanups);
    d.central.hooksInstall(true);
    await fetch(`${d.central.receptorUrl()}/hooks/SessionStart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
      body: JSON.stringify({
        session_id: "ext-1",
        hook_event_name: "SessionStart",
        cwd: d.project,
      }),
    });
    writeTranscript(d.historyRoot, "-p", "ext-1", [
      userLine({ uuid: "u1", text: "Do terminal", cwd: d.project, ts: "2026-09-01T10:00:00.000Z" }),
    ]);
    d.history.scan();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => Object.keys(store.getState().externals).length === 1);
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () =>
      store.router.push({ name: "external", host: hostId, claudeSessionId: "ext-1" }),
    );
    await settle(() => screen.queryByRole("button", { name: "Continuar no Flightdeck" }) !== null);
    await click("Continuar no Flightdeck");
    // The transcript was just written: the app asks before resuming it.
    await settle(() => screen.queryByRole("button", { name: "Continuar mesmo assim" }) !== null);
    await click("Continuar mesmo assim");
    await settle(() => store.router.current.name === "home");
    expect(store.router.current).toEqual({ name: "home" });
    expect(screen.queryByRole("button", { name: "Encerrar" })).not.toBeNull();
  });

  test("uma rota aberta antes de o host conectar (deep link na partida) carrega quando ele conecta", async () => {
    const d = makeDaemon(cleanups);
    writeTranscript(d.historyRoot, "-p", "hist-1", [
      userLine({
        uuid: "u1",
        text: "Do histórico",
        cwd: d.project,
        ts: "2026-09-01T10:00:00.000Z",
      }),
    ]);
    d.history.scan();
    const { sessionId } = d.manager.create({
      cwd: d.project,
      prompt: "olá do começo",
      name: "Cedo",
    });
    await poll(() => d.manager.get(sessionId).status === "idle");
    const url = d.listen().url;

    // The hosts are already saved, and the route comes before the app connects.
    const mem = memoryPlatform();
    const secrets = new Map<string, string>();
    seedDemoHosts(mem.win.localStorage, secrets, [
      { id: "h-fixo", name: "alfa", url, token: TOKEN },
    ]);
    const { createWebPlatform } = await import("../src/platform/web/index.ts");
    const store = new AppStore(createWebPlatform(mem.win, secrets), { baseDelayMs: 60_000 });
    store.router.push({ name: "session", host: "h-fixo", id: sessionId });
    render(<App store={store} />);
    await settle(() => (screen.queryByRole("main")?.textContent ?? "").includes("olá do começo"));
    expect(screen.queryByRole("main")?.textContent ?? "").toContain("olá do começo");

    await act(async () =>
      store.router.push({
        name: "reader",
        target: { hostId: "h-fixo", claudeSessionId: "hist-1" },
      }),
    );
    await settle(() => (screen.queryByRole("main")?.textContent ?? "").includes("Do histórico"));
    expect(screen.queryByRole("main")?.textContent ?? "").toContain("Do histórico");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("o leitor aberto antes da conexão espera o host, sem banner de erro", async () => {
    const d = makeDaemon(cleanups);
    writeTranscript(d.historyRoot, "-p", "hist-2", [
      userLine({
        uuid: "u2",
        text: "Leitura cedo",
        cwd: d.project,
        ts: "2026-09-01T10:00:00.000Z",
      }),
    ]);
    d.history.scan();
    const url = d.listen().url;
    const mem = memoryPlatform();
    const secrets = new Map<string, string>();
    seedDemoHosts(mem.win.localStorage, secrets, [
      { id: "h-fixo", name: "alfa", url, token: TOKEN },
    ]);
    const { createWebPlatform } = await import("../src/platform/web/index.ts");
    const store = new AppStore(createWebPlatform(mem.win, secrets), { baseDelayMs: 60_000 });
    store.router.push({ name: "reader", target: { hostId: "h-fixo", claudeSessionId: "hist-2" } });
    render(<App store={store} />);
    // While the saved hosts load and connect, the screen says so (its name may not be known yet).
    const status = screen.queryByRole("status")?.getAttribute("aria-label") ?? "";
    expect(status).toMatch(/^(Carregando…|Conectando a alfa…)$/);
    await settle(() => (screen.queryByRole("main")?.textContent ?? "").includes("Leitura cedo"));
    expect(screen.queryByRole("main")?.textContent ?? "").toContain("Leitura cedo");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("uma rota direta para um card (sem passar pelo board) carrega o card do host", async () => {
    const { d, store, card } = await setup();
    const hostId = store.getState().hosts[0]?.id ?? "";
    expect(store.getState().cards).toEqual({});
    await act(async () =>
      store.router.push({ name: "card", host: hostId, projectId: card.projectId, cardId: card.id }),
    );
    await settle(() => heading("Ajuste"));
    expect(heading("Ajuste")).toBe(true);
    expect(screen.queryByText("Card não encontrado.")).toBeNull();
    // Nothing was asked of the host with an empty project while the card was still loading.
    await act(async () => Bun.sleep(300));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(d.board.getCard(card.id).title).toBe("Ajuste");
  });

  test("o nome dado a uma sessão do terminal chega pelo external.updated, sem carregar a lista de sessões", async () => {
    const d = makeDaemon(cleanups);
    d.central.hooksInstall(true);
    const hook = (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
        body: JSON.stringify({
          session_id: "ext-n",
          hook_event_name: event,
          cwd: d.project,
          ...body,
        }),
      }).catch(() => undefined);
    await hook("SessionStart", {});
    d.central.meta.set("ext-n", { name: "Corrigir o import" });
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    // On Settings from the start, the hub is never mounted: the name cannot come from its list.
    store.router.push({ name: "settings" });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    void hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } });
    await settle(() => screen.queryByRole("button", { name: /^Precisa de você ?1$/ }) !== null);
    // The counter says so; the screen in use stays where it was.
    expect(store.router.current.name).toBe("settings");
    expect(screen.queryByRole("button", { name: /^Precisa de você ?1$/ })).not.toBeNull();
  });
});
