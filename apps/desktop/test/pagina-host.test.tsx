import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DAEMON_VERSION } from "../../daemon/src/server.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);

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
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";

async function setup(options: Parameters<typeof makeDaemon>[1] = {}) {
  const d = makeDaemon(cleanups, options);
  const server = d.listen(0, 20);
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull());
  const open = screen.queryByRole("button", { name: "Abrir host pc" });
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  // The host page is a lazy chunk: its title shows when the chunk has loaded, which on a loaded
  // machine is after the click has returned.
  await waitFor(() => expect(screen.queryByRole("heading", { name: "pc" })).not.toBeNull());
  return { ...d, server, store, hostId, ...mem };
}

describe("pagina-host", () => {
  test("a página abre nas sessões e projetos do host, e o resto fica em Visão geral, Consumo e Configurações", async () => {
    const { project, manager, store } = await setup();
    manager.create({ cwd: project, prompt: "primeira" });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Sessões de pc" })).not.toBeNull(),
    );
    const tabs = screen.getByRole("tablist", { name: "Seções do host" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Visão geral", "Consumo", "Configurações"]);
    expect(
      within(tabs).getByRole("tab", { name: "Visão geral" }).getAttribute("aria-selected"),
    ).toBe("true");
    // Sessions, then projects, then the information; the settings are on their own tab.
    const order = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(order.indexOf("Sessões de pc")).toBeLessThan(order.indexOf("Projetos de pc"));
    expect(order.indexOf("Projetos de pc")).toBeLessThan(order.indexOf("Informações"));
    // The settings are on a tab of their own: closed, its panel is hidden.
    const settings = [...document.querySelectorAll("[role='tabpanel']")].find((panel) =>
      panel.textContent?.includes("Reconectar"),
    );
    expect(settings?.getAttribute("data-state")).toBe("inactive");
    expect(document.querySelectorAll("[role='tabpanel'][data-state='active']")).toHaveLength(1);
    expect(store.getState().hosts).toHaveLength(1);
  });

  test("as abas respondem ao teclado, e Configurações traz hooks e as ações do host", async () => {
    await setup();
    const overview = screen.getByRole("tab", { name: "Visão geral" });
    overview.focus();
    await act(async () => {
      fireEvent.keyDown(overview, { key: "ArrowRight" });
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Consumo" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    const settings = screen.getByRole("tab", { name: "Configurações" });
    await act(async () => {
      fireEvent.mouseDown(settings);
      fireEvent.click(settings);
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reconectar" })).not.toBeNull(),
    );
    expect(screen.queryByRole("region", { name: "Hooks do Claude Code" })).not.toBeNull();
  });

  test("Ver todas as sessões e Ver todos os projetos levam à lista com o filtro do host", async () => {
    const { store, hostId, project, manager, root } = await setup();
    manager.create({ cwd: project, prompt: "uma" });
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    await act(async () => {
      await store.hostCommand(hostId, "project.add", { path: repo });
      await store.loadPalette();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ver todas as sessões" })).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ver todas as sessões" }));
    });
    expect(store.hubFilter().host).toBe("pc");
    expect(store.router.current.name).toBe("hub");
    await act(async () => {
      store.router.push({ name: "host", host: hostId });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ver todos os projetos" })).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ver todos os projetos" }));
    });
    expect(store.router.current).toEqual({ name: "all-projects", host: hostId });
  });

  test("mostra os dados do host.info e a latência do último ping", async () => {
    await setup();
    expect(screen.queryByRole("heading", { name: "pc" })).not.toBeNull();
    await waitFor(() => expect(text()).toContain(`${process.platform} · ${process.arch}`));
    expect(text()).toContain(`flightdeckd ${DAEMON_VERSION}`);
    expect(text()).toContain("claude: não informado");
    expect(text()).toContain("sessões ativas: 0");
    expect(text()).toMatch(/no ar há \d+ s/);
    await waitFor(() => expect(text()).toMatch(/latência: \d+ ms/));
    expect(text()).not.toContain("chave de API");
  });

  test("host que repassa a chave de API ganha selo de alerta", async () => {
    await setup({ allowApiKey: true, baseEnv: { ANTHROPIC_API_KEY: "sk-teste" } });
    await waitFor(() =>
      expect(screen.queryByLabelText("pc: chave de API repassada")).not.toBeNull(),
    );
    expect(text()).toContain("O consumo deste host pode estar indo para crédito de API");
  });

  test("renomear muda a barra lateral e o armazenamento", async () => {
    const { store, items } = await setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Renomear" }));
    });
    fireEvent.change(screen.getByLabelText("Nome do host"), { target: { value: "desktop" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    });
    expect(store.getState().hosts[0]?.name).toBe("desktop");
    expect(items.get("flightdeck.hosts")).toContain('"name":"desktop"');
    expect(screen.queryByLabelText("desktop: online")).not.toBeNull();
  });

  test("reconectar derruba e refaz a conexão; remover tira o host", async () => {
    const { store } = await setup();
    const statuses: string[] = [];
    store.subscribe(() => statuses.push(store.getState().hosts[0]?.status ?? "-"));
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Configurações" }));
      fireEvent.click(screen.getByRole("tab", { name: "Configurações" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    });
    await waitFor(() => expect(statuses).toContain("connecting"));
    await waitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remover host" }));
    });
    // The page asks first; the confirming button carries the same verb.
    await confirmWith("Remover host");
    expect(store.getState().hosts).toEqual([]);
  });

  test("daemon sem host.info (fase 1): página avisa que as informações estão indisponíveis", async () => {
    const old = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
      websocket: {
        message(ws, raw) {
          const { id, type } = JSON.parse(String(raw));
          const data = {
            hostName: "velho",
            daemonVersion: "0.1.0",
            protocolVersion: 1,
            allowedRoots: [],
          };
          ws.send(
            JSON.stringify(
              type === "hello"
                ? { type: "ack", id, ok: true, data }
                : {
                    type: "ack",
                    id,
                    ok: false,
                    error: { code: "bad_request", message: "desconhecido" },
                  },
            ),
          );
        },
      },
    });
    cleanups.push(() => old.stop(true));
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(() =>
      store.addHost({ name: "velho", url: `ws://127.0.0.1:${old.port}/`, token: TOKEN }),
    );
    await waitFor(() => expect(screen.queryByLabelText("velho: online")).not.toBeNull());
    const open = screen.queryByRole("button", { name: "Abrir host velho" });
    expect(open).not.toBeNull();
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await waitFor(() => expect(text()).toContain("informações indisponíveis"));
  });
});
