import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { breadcrumb } = await import("../src/lib/breadcrumb.ts");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const t = translator("pt-BR");

/** The parts of the state a path reads: one host, its sessions, history, cards and projects. */
const state = {
  hosts: [
    {
      id: "h",
      name: "alfa",
      sessions: [{ id: "s1", name: "Alpha", cwd: "/work/app" }],
    },
  ],
  meta: { "h/ext": { name: "Terminal nomeado" } },
  externals: { "h/ext": { cwd: "/work/ext" }, "h/sem-nome": { cwd: "/work/solto" } },
  hub: {
    h: { managed: [], history: [{ claudeSessionId: "old-1", title: "Revisar o build" }] },
  },
  cards: { "h/c1": { title: "Terminar" } },
  projects: { h: [{ id: "p1", name: "flightdeck-web" }] },
} as never;

type Route = Parameters<typeof breadcrumb>[0];
const labels = (route: Route) => breadcrumb(route, state, t).map((c) => c.label);
const targets = (route: Route) => breadcrumb(route, state, t).map((c) => c.route?.name ?? null);

describe("direcao-visual: cabeçalho", () => {
  test("o caminho de cada tela, do nome da área ao item aberto", () => {
    expect(labels({ name: "hub" })).toEqual(["Sessões"]);
    expect(labels({ name: "home" })).toEqual(["Sessões"]);
    expect(labels({ name: "session", host: "h", id: "s1" })).toEqual(["Sessões", "Alpha"]);
    expect(labels({ name: "session", host: "h", id: "nao-ha" })).toEqual(["Sessões", "nao-ha"]);
    expect(labels({ name: "external", host: "h", claudeSessionId: "ext" })).toEqual([
      "Sessões",
      "Terminal nomeado",
    ]);
    expect(labels({ name: "external", host: "h", claudeSessionId: "sem-nome" })).toEqual([
      "Sessões",
      "solto",
    ]);
    expect(labels({ name: "reader", target: { hostId: "h", claudeSessionId: "old-1" } })).toEqual([
      "Sessões",
      "Revisar o build",
    ]);
    expect(
      labels({ name: "reader", target: { hostId: "h", claudeSessionId: "abcdef123456" } }),
    ).toEqual(["Sessões", "abcdef12"]);
    expect(labels({ name: "new-session", host: "h" })).toEqual(["Sessões", "Nova sessão"]);
    expect(labels({ name: "needs-you" })).toEqual(["Precisa de você"]);
    expect(labels({ name: "history", host: "h" })).toEqual(["Histórico", "alfa"]);
    expect(
      labels({
        name: "reader",
        target: { hostId: "h", claudeSessionId: "old-1" },
        list: "history",
      }),
    ).toEqual(["Histórico", "alfa", "Revisar o build"]);
    expect(labels({ name: "host", host: "h" })).toEqual(["Hosts", "alfa"]);
    expect(labels({ name: "host", host: "outro" })).toEqual(["Hosts", "outro"]);
    expect(labels({ name: "projects", host: "h" })).toEqual(["alfa", "Projetos"]);
    expect(labels({ name: "projects", host: "h", focus: "board" })).toEqual(["alfa", "Board"]);
    expect(labels({ name: "projects", host: "h", focus: "workflows" })).toEqual([
      "alfa",
      "Workflows",
    ]);
    expect(labels({ name: "board", host: "h", projectId: "p1" })).toEqual([
      "alfa",
      "Board",
      "flightdeck-web",
    ]);
    expect(labels({ name: "board", host: "h", projectId: "?" })).toEqual(["alfa", "Board", "?"]);
    expect(
      labels({ name: "workflows", host: "h", projectId: "p1", projectName: "flightdeck-web" }),
    ).toEqual(["alfa", "Workflows", "flightdeck-web"]);
    expect(labels({ name: "card", host: "h", projectId: "p1", cardId: "c1" })).toEqual([
      "alfa",
      "Board",
      "flightdeck-web",
      "Terminar",
    ]);
    expect(labels({ name: "card", host: "h", projectId: "p1", cardId: "c?" })).toEqual([
      "alfa",
      "Board",
      "flightdeck-web",
      "c?",
    ]);
    expect(labels({ name: "costs" })).toEqual(["Custos"]);
    expect(labels({ name: "settings" })).toEqual(["Configurações"]);
    expect(labels({ name: "add-host" })).toEqual(["Hosts", "Adicionar host"]);
  });

  test("os passos de cima levam de volta: só eles têm destino, nunca o último", () => {
    expect(targets({ name: "hub" })).toEqual([null]);
    expect(targets({ name: "session", host: "h", id: "s1" })).toEqual(["hub", null]);
    expect(targets({ name: "history", host: "h" })).toEqual([null, null]);
    expect(
      targets({
        name: "reader",
        target: { hostId: "h", claudeSessionId: "old-1" },
        list: "history",
      }),
    ).toEqual([null, "history", null]);
    expect(targets({ name: "projects", host: "h" })).toEqual(["host", null]);
    expect(targets({ name: "board", host: "h", projectId: "p1" })).toEqual([
      "host",
      "projects",
      null,
    ]);
    expect(targets({ name: "card", host: "h", projectId: "p1", cardId: "c1" })).toEqual([
      "host",
      "projects",
      "board",
      null,
    ]);
    expect(targets({ name: "workflows", host: "h", projectId: "p1", projectName: "x" })).toEqual([
      "host",
      "projects",
      null,
    ]);
  });

  test("o cabeçalho mostra o caminho, o último passo marcado, e um passo de cima volta", async () => {
    const d = makeDaemon(cleanups);
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Alpha" });
    await poll(() => d.manager.get(sessionId).status === "idle");
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await act(() => Bun.sleep(300));
    await sidebar.openHub();
    const path = () => screen.queryByRole("navigation", { name: "Você está em" }) as HTMLElement;
    expect(path()?.textContent).toBe("Sessões");
    expect(within(path()).queryByText("Sessões")?.getAttribute("aria-current")).toBe("page");
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    expect(path()?.textContent).toBe("SessõesAlpha");
    expect(within(path()).queryByText("Alpha")?.getAttribute("aria-current")).toBe("page");
    expect(within(path()).queryByRole("button", { name: "Alpha" })).toBeNull();
    await act(async () => {
      fireEvent.click(within(path()).queryByRole("button", { name: "Sessões" }) as HTMLElement);
    });
    expect(store.router.current.name).toBe("hub");
    await act(async () => {
      store.router.push({ name: "host", host: hostId });
    });
    // "Hosts" heads the path; it is not a screen of its own.
    expect(within(path()).queryByRole("button", { name: "Hosts" })).toBeNull();
    expect(path()?.textContent).toBe("Hostsalfa");
  });

  test("em inglês, o caminho fala inglês", () => {
    const en = translator("en");
    expect(breadcrumb({ name: "new-session", host: "h" }, state, en).map((c) => c.label)).toEqual([
      "Sessions",
      "New session",
    ]);
    expect(breadcrumb({ name: "add-host" }, state, en).map((c) => c.label)).toEqual([
      "Hosts",
      "Add host",
    ]);
  });
});
