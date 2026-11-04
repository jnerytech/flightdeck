import { afterEach, describe, expect, test } from "bun:test";
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
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 4000 });
const text = () => document.body.textContent ?? "";

const DEAD = "ws://127.0.0.1:1/v1/ws";

/** A host that nothing answers for, its page open. The automatic retry is far away, so the page holds still. */
async function offlineHost() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.addHost({ name: "pc", url: DEAD, token: TOKEN }));
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

  test("the sections that need the connection say Host desconectado, not checking or unavailable", async () => {
    await offlineHost();
    const info = await waitFor(() => {
      const found = screen.queryByRole("region", { name: "Informações" });
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(info.textContent).toContain("Host desconectado");
    expect(text()).not.toContain("informações indisponíveis");
    const hooks = screen.queryByRole("region", { name: "Hooks do Claude Code" });
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

  test("an online host has no banner, and its uptime keeps counting", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen(0, 20);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
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
