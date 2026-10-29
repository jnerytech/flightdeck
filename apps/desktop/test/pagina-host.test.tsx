import { afterEach, describe, expect, test } from "bun:test";
import { DAEMON_VERSION } from "../../daemon/src/server.ts";
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
  return { ...d, server, store, hostId, ...mem };
}

describe("pagina-host", () => {
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
