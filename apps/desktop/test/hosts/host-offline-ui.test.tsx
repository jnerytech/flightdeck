import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";

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
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 4000 });
const text = () => document.body.textContent ?? "";

const DEAD = "ws://127.0.0.1:1/v1/ws";

/** 15:04:05 in São Paulo, 18:04:05 UTC: a time the system's own locale and zone cannot guess. */
const LAST_TRY = Date.parse("2026-10-30T18:04:05.000Z");

/** The banner alone for a host, in the app's language (pt-BR or en) and the São Paulo time zone. */
async function banner(
  host: Record<string, unknown>,
  over: { language?: "pt-BR" | "en"; onCopy?: (text: string) => Promise<boolean> } = {},
) {
  const { HostOfflineBanner } = await import("../../src/features/hosts/host-offline-banner.tsx");
  const { TContext } = await import("../../src/i18n/context.tsx");
  const { translator } = await import("../../src/i18n/index.ts");
  const language = over.language ?? "pt-BR";
  const store = new AppStore(memoryPlatform(false, language).platform, {
    timeZone: "America/Sao_Paulo",
  });
  store.i18n.start();
  cleanups.push(() => store.dispose());
  render(
    <TContext.Provider value={translator(language)}>
      <HostOfflineBanner
        host={{ id: "h1", name: "pc", hostInfo: null, ...host } as never}
        onReconnect={() => {}}
        formatTime={(iso) => store.formatTime(iso)}
        onCopy={over.onCopy ?? (async () => true)}
      />
    </TContext.Provider>,
  );
  return screen.getByRole("region", {
    name: language === "en" ? "Connection status" : "Estado da conexão",
  });
}

const OFFLINE = {
  url: "ws://127.0.0.1:7420/v1/ws",
  status: "offline",
  retry: { kind: "refused", lastTryAt: LAST_TRY, nextRetryAt: LAST_TRY + 60_000 },
};

/** A host that nothing answers for, its page open. The automatic retry is far away, so the page holds still. */
async function offlineHost() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000, wakeDebounceMs: 0 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.roster.add({ name: "pc", url: DEAD, token: TOKEN }));
  await waitFor(() => expect(store.getState().hosts[0]?.retry).not.toBeNull());
  const open = await waitFor(() => {
    const button = screen.queryByRole("button", { name: "Abrir host pc" });
    expect(button).not.toBeNull();
    return button as HTMLElement;
  });
  await act(async () => {
    fireEvent.click(open);
  });
  await waitFor(() => expect(screen.queryByRole("heading", { name: "pc" })).not.toBeNull());
  return store;
}

describe("host-offline-ui", () => {
  test("an offline host says so at the top: the state, what failed, the last try and the countdown", async () => {
    await offlineHost();
    const banner = await waitFor(() => {
      const found = screen.queryByRole("region", { name: "Estado da conexão" });
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const shown = banner.textContent ?? "";
    expect(shown).toContain("Host desconectado");
    expect(shown).toContain(`Nada respondeu em ${DEAD}`);
    expect(shown).toMatch(/Última tentativa: /);
    expect(shown).toMatch(/Próxima tentativa em \d+ s/);
  });

  test("a refused connection to a loopback host shows the Linux and WSL commands", async () => {
    await offlineHost();
    await waitFor(() => expect(text()).toContain("systemctl --user status flightdeckd"));
    expect(text()).toContain("sudo loginctl enable-linger");
    expect(text()).toContain("systemd=true");
  });

  test("the Information panel of an offline host says what it will show, not the banner's title again, and Hooks say Host desconectado", async () => {
    await offlineHost();
    const info = await waitFor(() => {
      const found = screen.queryByRole("region", { name: "Informações" });
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    // The banner above already says "Host desconectado": the panel says what it will hold instead (#3698).
    expect(info.textContent).not.toContain("Host desconectado");
    expect(info.textContent).toContain("Os detalhes do host aparecem aqui quando ele responder.");
    expect(text()).not.toContain("informações indisponíveis");
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Configurações" }));
      fireEvent.click(screen.getByRole("tab", { name: "Configurações" }));
    });
    const hooks = await waitFor(() => {
      const found = screen.queryByRole("region", { name: "Hooks do Claude Code" });
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(hooks?.textContent).toContain("Host desconectado");
    expect(text()).not.toContain("consultando…");
  });

  test("Reconectar agora shows progress and then the result", async () => {
    const store = await offlineHost();
    const first = store.getState().hosts[0]?.retry?.lastTryAt ?? 0;
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reconectar agora" })).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconectar agora" }));
    });
    await waitFor(() => expect(text()).toContain("Continua desconectado."));
    expect(store.getState().hosts[0]?.retry?.lastTryAt ?? 0).toBeGreaterThan(first);
  });

  test("the window regaining focus or the network coming back tries the offline host at once", async () => {
    const store = await offlineHost();
    for (const fire of [
      () => window.dispatchEvent(new window.Event("online")),
      () => window.dispatchEvent(new window.Event("focus")),
      () => document.dispatchEvent(new window.Event("visibilitychange")),
    ]) {
      // Past the debounce, as a person coming back minutes later would be.
      await act(async () => {
        await Bun.sleep(30);
      });
      const seen = store.getState().hosts[0]?.retry?.lastTryAt ?? 0;
      await act(async () => {
        fire();
      });
      await waitFor(() =>
        expect(store.getState().hosts[0]?.retry?.lastTryAt ?? 0).toBeGreaterThan(seen),
      );
    }
  });

  test("a host that refused the token says so, with no countdown to a retry that would be refused again", async () => {
    const region = await banner({
      url: "ws://10.0.0.5:7420/v1/ws",
      status: "unauthorized",
      retry: null,
    });
    expect(region.textContent).toContain("O host recusou o token. Pareie este host de novo.");
    expect(region.textContent).not.toMatch(/Próxima tentativa/);
  });

  test("a Windows host that refuses the connection gets the service commands, never the Linux ones (#3403)", async () => {
    const region = await banner({ ...OFFLINE, name: "Windows", hostInfo: { os: "win32" } });
    expect(region.textContent).toContain("flightdeckd service status");
    expect(region.textContent).toContain("flightdeckd service start");
    expect(region.textContent).not.toContain("systemctl");
    expect(region.textContent).not.toContain("loginctl");
    expect(region.textContent).not.toContain("wsl.conf");
  });

  test("the last try reads in the app's language and zone, not the system's (#3692)", async () => {
    const region = await banner(OFFLINE);
    expect(region.textContent).toContain("Última tentativa: 15:04 ·");
  });

  test("the last try of an app in English reads 12-hour with AM/PM, whatever the system's locale (#3692)", async () => {
    const region = await banner(OFFLINE, { language: "en" });
    expect(region.textContent).toMatch(/Last try: 0?3:04\s?PM ·/);
  });

  test("each Linux and WSL command has a copy button that hands exactly that text to the clipboard (#3694)", async () => {
    const copied: string[] = [];
    await banner(OFFLINE, {
      onCopy: async (text) => {
        copied.push(text);
        return true;
      },
    });
    const commands = [
      "systemctl --user status flightdeckd",
      "sudo loginctl enable-linger $USER",
      "systemd=true",
    ];
    for (const command of commands) {
      const button = screen.queryByRole("button", { name: `Copiar o comando ${command}` });
      expect(button).not.toBeNull();
      await act(async () => {
        fireEvent.click(button as HTMLElement);
      });
    }
    expect(copied).toEqual(commands);
  });

  test("a copy that lands says so in the banner's live region, and one the clipboard refuses says nothing (#3694)", async () => {
    let lands = true;
    const region = await banner(OFFLINE, { onCopy: async () => lands });
    const live = within(region).getByRole("status");
    const button = screen.queryByRole("button", { name: "Copiar o comando systemd=true" });
    expect(button).not.toBeNull();
    lands = false;
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(live.textContent).not.toContain("Copiado");
    lands = true;
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(live.textContent).toContain("Copiado");
  });

  test("a copy pressed while Reconnect now is trying does not hide the answer: it still says Continua desconectado (#3694)", async () => {
    const { HostOfflineBanner } = await import("../../src/features/hosts/host-offline-banner.tsx");
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const store = new AppStore(memoryPlatform().platform, { timeZone: "America/Sao_Paulo" });
    store.i18n.start();
    cleanups.push(() => store.dispose());
    const view = (host: Record<string, unknown>) => (
      <TContext.Provider value={translator("pt-BR")}>
        <HostOfflineBanner
          host={{ id: "h1", name: "pc", hostInfo: null, ...host } as never}
          onReconnect={() => {}}
          formatTime={(iso) => store.formatTime(iso)}
          onCopy={async () => true}
        />
      </TContext.Provider>
    );
    const { rerender } = render(view(OFFLINE));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconectar agora" }));
    });
    rerender(view({ ...OFFLINE, status: "connecting" }));
    const button = screen.queryByRole("button", { name: "Copiar o comando systemd=true" });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    rerender(
      view({
        ...OFFLINE,
        retry: { ...OFFLINE.retry, lastTryAt: LAST_TRY + 5_000, nextRetryAt: LAST_TRY + 65_000 },
      }),
    );
    const live = screen.getByRole("status");
    expect(live.textContent).toContain("Continua desconectado.");
    expect(live.textContent).not.toContain("Copiado");
  });

  test("a copy while an automatic retry is trying is still announced, since no Reconnect answer is waiting (#3694)", async () => {
    const region = await banner({ ...OFFLINE, status: "connecting" });
    const button = screen.queryByRole("button", { name: "Copiar o comando systemd=true" });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(within(region).getByRole("status").textContent).toContain("Copiado");
  });

  test("the Information panel of a host that refused the token does not promise it will answer (#3698)", async () => {
    const { HostInfoPanel } = await import("../../src/features/hosts/host-info-panel.tsx");
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const store = new AppStore(memoryPlatform().platform);
    cleanups.push(() => store.dispose());
    render(
      <TContext.Provider value={translator("pt-BR")}>
        <HostInfoPanel
          store={store}
          host={{ id: "h1", name: "pc", hostInfo: null, status: "unauthorized" } as never}
          offline
        />
      </TContext.Provider>,
    );
    const panel = screen.getByRole("region", { name: "Informações" });
    expect(panel.textContent).not.toContain("quando ele responder");
    expect(panel.textContent).toContain("informações indisponíveis");
  });

  test("the copy buttons are named in English for an app in English (#3694)", async () => {
    await banner(OFFLINE, { language: "en" });
    expect(
      screen.queryByRole("button", { name: "Copy the command sudo loginctl enable-linger $USER" }),
    ).not.toBeNull();
  });

  test("a Windows host's two service commands have a copy button each (#3694)", async () => {
    await banner({ ...OFFLINE, hostInfo: { os: "win32" } });
    for (const command of ["flightdeckd service status", "flightdeckd service start"]) {
      expect(screen.queryByRole("button", { name: `Copiar o comando ${command}` })).not.toBeNull();
    }
    expect(screen.queryByRole("button", { name: /systemctl/ })).toBeNull();
  });

  test("a host with only the generic hint has no command, so no copy button (#3694)", async () => {
    await banner({ ...OFFLINE, hostInfo: { os: "darwin" } });
    expect(screen.queryAllByRole("button", { name: /^Copiar o comando/ })).toHaveLength(0);
  });

  test("a refused connection to a non-loopback address says the daemon may have refused this machine", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    // 0.0.0.0 reaches this machine and nothing listens: refused, and not a loopback name.
    await act(() => store.roster.add({ name: "pc", url: "ws://0.0.0.0:1/v1/ws", token: TOKEN }));
    await waitFor(() => expect(store.getState().hosts[0]?.retry?.kind).toBe("refused"));
    const open = await waitFor(() => {
      const button = screen.queryByRole("button", { name: "Abrir host pc" });
      expect(button).not.toBeNull();
      return button as HTMLElement;
    });
    await act(async () => {
      fireEvent.click(open);
    });
    await waitFor(() => expect(text()).toContain("recusou o endereço desta máquina"));
    expect(text()).toContain("allowedNetworks");
  });

  test("an online host has no banner, and its uptime keeps counting", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen(0, 20);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(() => store.roster.add({ name: "pc", url: server.url, token: TOKEN }));
    await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir host pc" }));
    });
    await waitFor(() => expect(text()).toMatch(/no ar há \d+ s/));
    expect(screen.queryByRole("region", { name: "Estado da conexão" })).toBeNull();
    const seconds = () => Number(/no ar há (\d+) s/.exec(text())?.[1] ?? "-1");
    const first = seconds();
    await waitFor(() => expect(seconds()).toBeGreaterThan(first));
  });
});
