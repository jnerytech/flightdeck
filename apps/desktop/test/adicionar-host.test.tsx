import { afterEach, describe, expect, test } from "bun:test";
import { formatPairingLink } from "@flightdeck/protocol";
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
const { AppStore } = await import("../src/lib/app-store.ts");
const { probeHost } = await import("../src/lib/probe-host.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
/** Asserts presence, so a missing field fails as an assertion rather than a query error. */
const field = (label: string) => {
  const element = screen.queryByLabelText(label);
  expect(element).not.toBeNull();
  return element as HTMLInputElement;
};
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });

function setup() {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  return { ...d, server, store, ...mem, port: String(server.port) };
}

const submit = () =>
  act(async () => {
    const button = screen.queryByRole("button", { name: "Testar e adicionar" });
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
  });

describe("adicionar-host", () => {
  test("probeHost faz hello e host.info e devolve os dados do host", async () => {
    const { server } = setup();
    const ok = await probeHost(server.url, TOKEN);
    expect(ok).toMatchObject({ ok: true, info: { hostName: "h1", protocolVersion: 1 } });
    expect(ok.ok && typeof ok.info.arch).toBe("string");
    expect(await probeHost(server.url, "errado")).toEqual({
      ok: false,
      error: "token recusado: rode flightdeckd pair no host e cole o link novo",
    });
    expect(await probeHost("ws://127.0.0.1:1/v1/ws", TOKEN)).toEqual({
      ok: false,
      error:
        "não foi possível conectar: confira se o daemon está rodando e se o endereço confere. No host, rode flightdeckd doctor",
    });
  });

  test("daemon que recusa host.info (fase 1) devolve a mensagem de erro dele", async () => {
    const old = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
      websocket: {
        message(ws, raw) {
          const { id, type } = JSON.parse(String(raw));
          ws.send(
            JSON.stringify(
              type === "hello"
                ? {
                    type: "ack",
                    id,
                    ok: true,
                    data: {
                      hostName: "velho",
                      daemonVersion: "0.1.0",
                      protocolVersion: 1,
                      allowedRoots: [],
                    },
                  }
                : {
                    type: "ack",
                    id,
                    ok: false,
                    error: { code: "bad_request", message: "comando desconhecido" },
                  },
            ),
          );
        },
      },
    });
    cleanups.push(() => old.stop(true));
    expect(await probeHost(`ws://127.0.0.1:${old.port}/`, TOKEN)).toEqual({
      ok: false,
      error: "comando desconhecido",
    });
  });

  test("colar o link de pareamento preenche nome, endereço, porta e token", () => {
    setup();
    type(
      "Link de pareamento",
      formatPairingLink({ address: "100.64.0.9", port: 7421, name: "orange pi", token: "abc" }),
    );
    expect(field("Nome").value).toBe("orange pi");
    expect(field("Endereço").value).toBe("100.64.0.9");
    expect(field("Porta").value).toBe("7421");
    expect(field("Token").value).toBe("abc");
  });

  test("preenchimento manual: testa a conexão e só então salva", async () => {
    const { port, store, items } = setup();
    type("Nome", "meu pc");
    type("Endereço", "127.0.0.1");
    type("Porta", port);
    type("Token", TOKEN);
    await submit();
    await waitFor(() => expect(screen.getByLabelText("meu pc: online")).toBeTruthy());
    expect(store.getState().hosts.map((h) => h.url)).toEqual([`ws://127.0.0.1:${port}/v1/ws`]);
    expect(items.get("flightdeck.hosts")).toContain("meu pc");
  });

  test("token errado ou host fora do ar: mostra o erro e não salva", async () => {
    const { port, store, items } = setup();
    type("Nome", "pc");
    type("Endereço", "127.0.0.1");
    type("Porta", port);
    type("Token", "errado");
    await submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("token recusado"));
    type("Porta", "1");
    type("Token", TOKEN);
    await submit();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("não foi possível conectar"),
    );
    expect(store.getState().hosts).toEqual([]);
    expect(items.has("flightdeck.hosts")).toBe(false);
  });

  test("campos obrigatórios e porta inválida não chegam a testar", async () => {
    const { store } = setup();
    await submit();
    type("Nome", "pc");
    type("Endereço", "127.0.0.1");
    type("Porta", "99999");
    type("Token", TOKEN);
    await submit();
    expect(screen.getByRole("alert").textContent).toContain("porta inválida");
    expect(store.getState().hosts).toEqual([]);
  });
});
