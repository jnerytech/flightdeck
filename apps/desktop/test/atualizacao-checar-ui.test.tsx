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
const { APP_VERSION } = await import("../src/lib/version.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";

interface Fake {
  /** The version the daemon reports. */
  version: string;
  /** What `host.info` says about the last check. */
  update: { available: boolean; version: string | null; checkedAt: string; error?: string };
  /** What `daemon.update.check` finds next; `refuse` makes it fail instead. */
  found: { available: boolean; version: string | null; checkedAt: string; error?: string };
  refuse: boolean;
  checks: number;
}

/** A daemon that answers host.info with a stale update status and counts `daemon.update.check`. */
function fakeDaemon(init: Partial<Fake> = {}) {
  const state: Fake = {
    version: "0.1.0",
    update: { available: false, version: "0.1.0", checkedAt: "2026-11-03T08:00:00.000Z" },
    found: { available: true, version: "9.9.9", checkedAt: "2026-11-03T10:30:00.000Z" },
    refuse: false,
    checks: 0,
    ...init,
  };
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
        if (type === "hello") {
          ack({
            hostName: "h",
            daemonVersion: state.version,
            protocolVersion: 1,
            allowedRoots: [],
          });
          return;
        }
        if (type === "host.info") {
          ack({
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
            update: state.update,
          });
          return;
        }
        if (type === "daemon.update.check") {
          state.checks++;
          if (state.refuse) {
            ws.send(
              JSON.stringify({
                type: "ack",
                id,
                ok: false,
                error: {
                  code: "invalid_state",
                  message: "no update source",
                  reason: "feature_off",
                  params: { feature: "updater" },
                },
              }),
            );
            return;
          }
          ack(state.found);
          return;
        }
        ws.send(
          JSON.stringify({
            type: "ack",
            id,
            ok: false,
            error: { code: "bad_request", message: "desconhecido" },
          }),
        );
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: `ws://127.0.0.1:${server.port}/`, state };
}

const clock = { at: Date.parse("2026-11-03T10:30:00.000Z") };

async function connect(url: string) {
  const store = new AppStore(memoryPlatform().platform, {
    baseDelayMs: 10,
    now: () => clock.at,
  });
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

describe("atualizacao-checar-ui: the host page checks for a daemon update", () => {
  test("a daemon older than the app is asked once on its own, and the update button shows", async () => {
    clock.at = Date.parse("2026-11-03T10:30:00.000Z");
    const daemon = fakeDaemon();
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Atualizar daemon para 9.9.9" })).not.toBeNull(),
    );
    expect(daemon.state.checks).toBe(1);
  });

  test("asking again within 10 minutes does not reach the daemon; after 10 minutes it does", async () => {
    clock.at = Date.parse("2026-11-03T10:30:00.000Z");
    const daemon = fakeDaemon({ found: { available: false, version: "0.1.0", checkedAt: "x" } });
    const store = await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() => expect(daemon.state.checks).toBe(1));
    const id = store.getState().hosts[0]?.id ?? "";
    clock.at += 9 * 60_000;
    await act(async () => {
      await store.autoCheckDaemonUpdate(id);
    });
    expect(daemon.state.checks).toBe(1);
    clock.at += 2 * 60_000;
    await act(async () => {
      await store.autoCheckDaemonUpdate(id);
    });
    expect(daemon.state.checks).toBe(2);
  });

  test("a daemon on the app's version is not asked on its own, but the button asks now", async () => {
    const daemon = fakeDaemon({
      version: APP_VERSION,
      update: { available: false, version: APP_VERSION, checkedAt: "2026-11-03T08:00:00.000Z" },
      found: { available: true, version: "9.9.9", checkedAt: "2026-11-03T10:30:00.000Z" },
    });
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Verificar atualizações" })).not.toBeNull(),
    );
    await Bun.sleep(100);
    expect(daemon.state.checks).toBe(0);
    await click("Verificar atualizações");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Atualizar daemon para 9.9.9" })).not.toBeNull(),
    );
    expect(daemon.state.checks).toBe(1);
  });

  test("it shows when the daemon last checked and the error of that check", async () => {
    const daemon = fakeDaemon({
      version: APP_VERSION,
      update: {
        available: false,
        version: null,
        checkedAt: "2026-11-03T08:00:00.000Z",
        error: "o servidor respondeu HTTP 503",
      },
    });
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() => expect(text()).toContain("Última verificação"));
    expect(text()).toContain("o servidor respondeu HTTP 503");
  });

  test("a daemon that refuses the check says why, with its reason", async () => {
    const daemon = fakeDaemon({ version: APP_VERSION, refuse: true });
    await connect(daemon.url);
    await click("Abrir host pc");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Verificar atualizações" })).not.toBeNull(),
    );
    await click("Verificar atualizações");
    await waitFor(() => expect(text()).toContain("A verificação não rodou"));
    expect(daemon.state.checks).toBe(1);
  });
});
