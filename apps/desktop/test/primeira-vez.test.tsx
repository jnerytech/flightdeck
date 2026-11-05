import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
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
const { translator } = await import("../src/i18n/index.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const PORTUGUESE = /inválid|ausente|recusado|pareamento/i;

describe("primeira-vez: the first run reads in the app's language (issue #184, J1)", () => {
  test("a pairing link that is not one says so in English, with no Portuguese", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    render(<App store={store} />);
    const cases: Array<[string, string]> = [
      ["http://pc:7420?token=t", "That is not a flightdeck:// link."],
      ["flightdeck://:7420?token=t", "The link has no host address."],
      ["flightdeck://pc:99999?token=t", "The link's port is not valid."],
      ["flightdeck://pc:7420?name=x", "The link has no token."],
    ];
    for (const [link, message] of cases) {
      fireEvent.change(screen.getByLabelText("Pairing link"), { target: { value: link } });
      expect(screen.queryByText(message)).not.toBeNull();
    }
    expect(document.body.textContent ?? "").not.toMatch(PORTUGUESE);
  });

  test("the same mistakes read in Portuguese in the Portuguese app", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    fireEvent.change(screen.getByLabelText("Link de pareamento"), {
      target: { value: "flightdeck://pc:7420?name=x" },
    });
    expect(screen.queryByText("O link não traz o token.")).not.toBeNull();
  });

  test("an opened link that is refused says why in English", async () => {
    const mem = memoryPlatform(false, "en");
    const store = new AppStore(mem.platform);
    render(<App store={store} />);
    await act(async () => {
      mem.deepLink("flightdeck://pc:99999?token=a");
    });
    await rtlWaitFor(() =>
      expect(screen.queryByRole("alert")?.textContent ?? "").toContain(
        "Pairing link refused. The link's port is not valid.",
      ),
    );
  });

  test("with every tab closed and no host, the empty window offers to add one", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    render(<App store={store} />);
    await act(async () => {
      store.closeTab(store.tabs, store.tabs.activeId);
    });
    const start = screen.queryByRole("region", { name: "Nothing open" }) as HTMLElement;
    expect(start).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(start).getByRole("button", { name: "Add a host" }));
    });
    expect(store.tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["add-host"]);
  });
});

describe("primeira-vez: the probe gives up (issue #184, J1)", () => {
  /** A host that accepts the connection and never answers. */
  function silentHost() {
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
      websocket: { message() {}, open() {} },
    });
    return { server, url: `ws://127.0.0.1:${server.port}/v1/ws` };
  }

  test("a host that never answers ends the test with a timeout that names the cause", async () => {
    const { server, url } = silentHost();
    try {
      let fire: () => void = () => {};
      const probe = probeHost(url, "t", translator("en"), {
        timeoutMs: 8000,
        timer: {
          set: (fn, ms) => {
            expect(ms).toBe(8000);
            fire = fn;
            return 1;
          },
          clear: () => {},
        },
      });
      const pending = Symbol("pending");
      expect(await Promise.race([probe, Promise.resolve(pending)])).toBe(pending);
      fire();
      const settled = await Promise.race([probe, Promise.resolve(pending)]);
      expect(settled).not.toBe(pending);
      expect(await probe).toEqual({
        ok: false,
        error: translator("en")("hostForm.probeTimeout"),
      });
      expect(translator("en")("hostForm.probeTimeout")).toContain("did not answer");
    } finally {
      await server.stop(true);
    }
  });

  test("a host that answers in time never meets the timer", async () => {
    const cleared: number[] = [];
    const result = await probeHost("ws://127.0.0.1:1/v1/ws", "t", translator("en"), {
      timer: { set: () => 7, clear: (handle) => cleared.push(handle as number) },
    });
    expect(result.ok).toBe(false);
    expect(cleared).toEqual([7]);
  });
});

describe("primeira-vez: a host that refused the token can be paired again (issue #184, J1)", () => {
  /** A host added with a token the daemon refuses. */
  async function refused() {
    const d = makeDaemon(cleanups);
    const server = d.listen();
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 60_000,
      wakeDebounceMs: 0,
    });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: server.url, token: "wrong-token" });
    await rtlWaitFor(() => expect(store.getState().hosts[0]?.status).toBe("unauthorized"), {
      timeout: 4000,
    });
    return { store, hostId, url: server.url };
  }

  test("a new token brings the same host online, without adding another", async () => {
    const { store, hostId } = await refused();
    expect(await store.pairAgain(hostId, TOKEN)).toBeNull();
    await rtlWaitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"), {
      timeout: 4000,
    });
    expect(store.getState().hosts.map((h) => h.id)).toEqual([hostId]);
  });

  test("a pasted pairing link works too, and a token the host refuses says so and changes nothing", async () => {
    const { store, hostId, url } = await refused();
    const port = new URL(url.replace("ws://", "http://")).port;
    expect(await store.pairAgain(hostId, "still-wrong")).toBe(
      store.i18n.t("hostForm.probeRefused"),
    );
    expect(store.getState().hosts[0]?.status).toBe("unauthorized");
    expect(await store.pairAgain(hostId, "flightdeck://pc:1")).toBe(
      store.i18n.t("hostForm.pairToken"),
    );
    expect(
      await store.pairAgain(hostId, `flightdeck://127.0.0.1:${port}?token=${TOKEN}&name=pc`),
    ).toBeNull();
  });

  test("the notice asks for the new link or token and shows what the host answered", async () => {
    const { HostOfflineBanner } = await import("../src/components/hosts/host-offline-banner.tsx");
    const asked: string[] = [];
    render(
      <HostOfflineBanner
        host={
          {
            id: "h1",
            name: "pc",
            url: "ws://10.0.0.5:7420/v1/ws",
            status: "unauthorized",
            retry: null,
            hostInfo: null,
          } as never
        }
        onReconnect={() => {}}
        onPairAgain={async (input) => {
          asked.push(input);
          return "token refused";
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Novo link de pareamento ou token"), {
      target: { value: "abc" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Parear de novo" }));
    });
    expect(asked).toEqual(["abc"]);
    expect(screen.queryByText("token refused")).not.toBeNull();
  });

  test("a host that is only offline, not refused, has no such field", async () => {
    const { HostOfflineBanner } = await import("../src/components/hosts/host-offline-banner.tsx");
    render(
      <HostOfflineBanner
        host={
          {
            id: "h1",
            name: "pc",
            url: "ws://10.0.0.5:7420/v1/ws",
            status: "offline",
            retry: { kind: "refused", lastTryAt: 0, nextRetryAt: 1 },
            hostInfo: null,
          } as never
        }
        onReconnect={() => {}}
        onPairAgain={async () => null}
      />,
    );
    expect(screen.queryByLabelText("Novo link de pareamento ou token")).toBeNull();
    expect(screen.queryByRole("button", { name: "Parear de novo" })).toBeNull();
  });
});
