import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";

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
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";

/**
 * A daemon on 0.8.0 whose manifest offers 9.9.9. On `daemon.update.apply` it comes back on 9.9.9
 * (`mode: "updates"`), never comes back (`"stalls"`) or refuses (`"refuses"`).
 */
function fakeDaemon(mode: "updates" | "stalls" | "refuses") {
  const state = { version: "0.8.0", applies: 0 };
  const sockets = new Set<ServerWebSocket<unknown>>();
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
    websocket: {
      open: (ws) => {
        sockets.add(ws);
      },
      close: (ws) => {
        sockets.delete(ws);
      },
      message(ws, raw) {
        const { id, type } = JSON.parse(String(raw));
        const ack = (data: unknown) => {
          ws.send(JSON.stringify({ type: "ack", id, ok: true, data }));
        };
        const fail = (code: string, message: string) => {
          ws.send(JSON.stringify({ type: "ack", id, ok: false, error: { code, message } }));
        };
        if (type === "hello") {
          return ack({
            hostName: "h",
            daemonVersion: state.version,
            protocolVersion: 1,
            allowedRoots: [],
          });
        }
        if (type === "host.info") {
          return ack({
            hostName: "h",
            os: "linux",
            arch: "x64",
            daemonVersion: state.version,
            claudeVersion: null,
            claudePath: null,
            uptimeSec: 1,
            activeSessions: 0,
            apiKeySanitized: true,
            features: [],
            update: {
              available: state.version !== "9.9.9",
              version: "9.9.9",
              checkedAt: "2026-11-02T10:00:00.000Z",
            },
          });
        }
        if (type === "daemon.update.apply") {
          state.applies++;
          if (mode === "refuses") {
            return fail("update_needs_service", "o daemon não roda como serviço");
          }
          ack({ started: true });
          if (mode === "updates") {
            // The daemon stops, the new one comes up: every connection drops.
            state.version = "9.9.9";
            for (const socket of sockets) socket.close();
          }
          return;
        }
        return fail("bad_request", "desconhecido");
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: `ws://127.0.0.1:${server.port}/`, state };
}

async function connect(url: string, opts: { offer?: { version: string; notes: string } } = {}) {
  const mem = memoryPlatform();
  if (opts.offer) {
    const offer = opts.offer;
    mem.platform.updater = { supported: true, check: async () => offer, install: async () => {} };
  }
  const store = new AppStore(mem.platform, { baseDelayMs: 10, daemonUpdateTimeoutMs: 300 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.addHost({ name: "pc", url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull());
  return store;
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("hosts-update-ui", () => {
  test("botão por host com confirmação; atualizando… até reconectar na versão nova", async () => {
    const daemon = fakeDaemon("updates");
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Atualizar daemon para 9.9.9" })).not.toBeNull(),
    );
    await click("Atualizar daemon para 9.9.9");
    expect(text()).toContain("Atualizar o daemon de pc para 9.9.9?");
    await click("Cancelar");
    expect(daemon.state.applies).toBe(0);
    await click("Atualizar daemon para 9.9.9");
    await click("Atualizar daemon");
    await waitFor(() => expect(text()).toContain("flightdeckd 9.9.9"));
    expect(daemon.state.applies).toBe(1);
    expect(text()).not.toContain("atualizando…");
    expect(screen.queryByRole("button", { name: "Atualizar daemon para 9.9.9" })).toBeNull();
  });

  test("sem voltar na versão nova no prazo, mostra a falha e o comando manual", async () => {
    const daemon = fakeDaemon("stalls");
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Atualizar daemon para 9.9.9" })).not.toBeNull(),
    );
    await click("Atualizar daemon para 9.9.9");
    await click("Atualizar daemon");
    await waitFor(() => expect(text()).toContain("atualizando…"));
    await waitFor(() => expect(text()).toContain("o daemon não voltou na versão 9.9.9"));
    expect(text()).toContain("flightdeckd update --from");
  });

  test("daemon que recusa (sem serviço) mostra o motivo e o comando manual", async () => {
    const daemon = fakeDaemon("refuses");
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Atualizar daemon para 9.9.9" })).not.toBeNull(),
    );
    await click("Atualizar daemon para 9.9.9");
    await click("Atualizar daemon");
    await waitFor(() => expect(text()).toContain("o daemon não roda como serviço"));
    expect(text()).toContain("flightdeckd update --from");
  });

  test("app e daemons desatualizados: a faixa sugere atualizar primeiro o app", async () => {
    const daemon = fakeDaemon("updates");
    await connect(daemon.url, { offer: { version: "0.9.1", notes: "" } });
    await waitFor(() =>
      expect(text()).toContain("Atualize primeiro o app e depois os daemons dos hosts."),
    );
  });
});
