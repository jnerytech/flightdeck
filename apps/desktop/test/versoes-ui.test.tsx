import { afterEach, describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@flightdeck/protocol";
import pkg from "../package.json";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

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
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { APP_VERSION } = await import("../src/lib/version.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";

/**
 * A daemon that only knows `hello` and `host.info`: answers the hello as `incompatible` asks and
 * `host.info` with `info` over a phase 7 default. Everything else is an unknown command.
 */
function fakeDaemon(opts: { incompatible?: boolean; info?: Record<string, unknown> } = {}) {
  const hellos: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
    websocket: {
      message(ws, raw) {
        const { id, type, payload } = JSON.parse(String(raw));
        const ack = (data: unknown) => {
          ws.send(JSON.stringify({ type: "ack", id, ok: true, data }));
        };
        const fail = (code: string, message: string) => {
          ws.send(JSON.stringify({ type: "ack", id, ok: false, error: { code, message } }));
        };
        if (type === "hello") {
          hellos.push(payload);
          if (opts.incompatible) {
            return fail(
              "protocol_incompatible",
              "protocolo 1 do cliente fora do intervalo do daemon [2, 3]",
            );
          }
          return ack({
            hostName: "h",
            daemonVersion: "0.6.0",
            protocolVersion: 1,
            allowedRoots: [],
          });
        }
        if (type === "host.info") {
          return ack({
            hostName: "h",
            os: "linux",
            arch: "x64",
            daemonVersion: "0.6.0",
            claudeVersion: "2.1.0 (Claude Code)",
            claudePath: "/usr/bin/claude",
            uptimeSec: 5,
            activeSessions: 0,
            apiKeySanitized: true,
            features: ["central", "workflows", "maintenance"],
            ...opts.info,
          });
        }
        if (type === "hooks.status") return ack({ status: "absent", settingsPath: "/s.json" });
        return fail("bad_request", "desconhecido");
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: `ws://127.0.0.1:${server.port}/`, hellos };
}

async function connect(url: string, label: string) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText(`pc: ${label}`)).not.toBeNull());
  return { store, hostId };
}

async function openHost() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Abrir host pc" }));
  });
}

describe("versoes-ui", () => {
  test("a versão do app é a do package.json, e o hello leva a versão de protocolo do app", async () => {
    expect(APP_VERSION).toBe(pkg.version);
    const daemon = fakeDaemon({ info: { daemonVersion: APP_VERSION } });
    await connect(daemon.url, "online");
    expect(daemon.hellos[0]?.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  test("daemon de outra versão ganha o selo; a página mostra daemon, claude e app", async () => {
    const daemon = fakeDaemon();
    await connect(daemon.url, "online");
    await waitFor(() => expect(screen.queryByLabelText("pc: versão diferente")).not.toBeNull());
    await openHost();
    await waitFor(() => expect(text()).toContain("flightdeckd 0.6.0"));
    expect(text()).toContain("claude: 2.1.0 (Claude Code)");
    expect(text()).toContain(`app ${APP_VERSION}`);
    expect(text()).toContain("versão diferente da do app");
  });

  test("daemon da mesma versão do app não tem selo", async () => {
    const daemon = fakeDaemon({ info: { daemonVersion: APP_VERSION } });
    await connect(daemon.url, "online");
    await openHost();
    await waitFor(() => expect(text()).toContain(`flightdeckd ${APP_VERSION}`));
    expect(screen.queryByLabelText("pc: versão diferente")).toBeNull();
    expect(text()).not.toContain("versão diferente da do app");
  });

  test("host incompatível: não reconecta, sai das listas e a página mostra o comando de atualização", async () => {
    const daemon = fakeDaemon({ incompatible: true });
    const { store, hostId } = await connect(daemon.url, "incompatível: atualize o daemon");
    expect(store.getState().hosts[0]?.status).toBe("incompatible");
    for (const name of ["Nova sessão em pc", "Histórico de pc", "Projetos de pc"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    await act(() => store.searchHistory("qualquer"));
    expect(store.getState().search?.silent).not.toContain(hostId);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir Sessões" }));
    });
    await sidebar.openFilters();
    const hosts = within(screen.getByLabelText("Host")).queryAllByRole("option");
    expect(hosts.map((o) => o.textContent)).toEqual(["Todos os hosts"]);
    await openHost();
    expect(text()).toContain("incompatível: atualize o daemon");
    expect(text()).toContain("flightdeckd update --from");
    expect(text()).toContain("fora do intervalo do daemon [2, 3]");
    expect(screen.queryByLabelText("Hooks do Claude Code")).toBeNull();
    // A wrong protocol does not fix itself: no new attempts.
    await Bun.sleep(100);
    expect(daemon.hellos).toHaveLength(1);
  });

  test("recurso não anunciado fica escondido; host sem features (antes da fase 7) mostra o que já tinha", async () => {
    const none = fakeDaemon({ info: { features: [] } });
    await connect(none.url, "online");
    await openHost();
    await waitFor(() => expect(text()).toContain("flightdeckd 0.6.0"));
    expect(screen.queryByLabelText("Hooks do Claude Code")).toBeNull();
    expect(await sidebar.hostMenuItems("pc")).not.toContain("Projetos");
    cleanup();
    const legacy = fakeDaemon({ info: { features: undefined } });
    await connect(legacy.url, "online");
    await openHost();
    await waitFor(() => expect(text()).toContain("flightdeckd 0.6.0"));
    expect(screen.queryByLabelText("Hooks do Claude Code")).not.toBeNull();
    expect(await sidebar.hostMenuItems("pc")).toContain("Projetos");
  });

  describe("idioma: the host page in English", () => {
    test("an incompatible host says how to update, with no Portuguese left on the page", async () => {
      const daemon = fakeDaemon({ incompatible: true });
      const { store } = await connect(daemon.url, "incompatível: atualize o daemon");
      await openHost();
      await act(async () => store.i18n.setLang("en"));
      await waitFor(() =>
        expect(text()).toContain(`On the host, with this app version's binary (${APP_VERSION}):`),
      );
      expect(text()).toContain("flightdeckd update --from <new binary>");
      expect(text()).not.toContain("binário");
    });

    test("the hooks status and the API-key notice are in English too", async () => {
      const daemon = fakeDaemon({ info: { apiKeySanitized: false } });
      const { store } = await connect(daemon.url, "online");
      await openHost();
      await act(async () => store.i18n.setLang("en"));
      await waitFor(() => expect(text()).toContain("This host's usage may be going to API credit"));
      expect(text()).toContain("absent");
      expect(text()).not.toContain("ausentes");
      expect(text()).not.toContain("crédito de API");
    });
  });
});
