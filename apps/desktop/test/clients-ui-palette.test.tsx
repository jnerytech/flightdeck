import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const client = (id: string, name: string) => ({
  id,
  name,
  color: "indigo",
  rules: [],
  defaults: { vaultScope: false },
});

async function open(clients: unknown[]) {
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify({ v: 1, clients, overrides: {} }));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const daemon = legacyDaemon(cleanups);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store };
}

const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
const palette = (label: string) =>
  dialog()?.querySelector(`[role='option'][aria-label='${label}']`) ?? null;
const optionLabels = () =>
  [...(dialog()?.querySelectorAll("[role='option']") ?? [])]
    .map((o) => o.getAttribute("aria-label") ?? "")
    .filter((l) => /cliente/i.test(l));
async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  expect(dialog()).not.toBeNull();
}
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("clients-ui: the palette", () => {
  test("it offers Manage clients, and a switch to all, to each client and to Unassigned", async () => {
    await open([client("acme", "Acme"), client("beta", "Beta")]);
    await openPalette();
    expect(optionLabels()).toEqual([
      "Gerenciar clientes",
      "Cliente: Todos os clientes",
      "Cliente: Acme",
      "Cliente: Beta",
      "Cliente: Sem cliente",
    ]);
  });

  test("with no client it offers only Manage clients, so the first one can be made", async () => {
    await open([]);
    await openPalette();
    expect(optionLabels()).toEqual(["Gerenciar clientes"]);
  });

  test("choosing a client selects it and closes the palette", async () => {
    const { store } = await open([client("acme", "Acme"), client("beta", "Beta")]);
    await openPalette();
    await click(palette("Cliente: Beta"));
    expect(store.getState().clientSelection).toBe("beta");
    expect(dialog()).toBeNull();
  });

  test("choosing Unassigned or all clients selects them", async () => {
    const { store } = await open([client("acme", "Acme")]);
    await openPalette();
    await click(palette("Cliente: Sem cliente"));
    expect(store.getState().clientSelection).toBe("unassigned");
    await openPalette();
    await click(palette("Cliente: Todos os clientes"));
    expect(store.getState().clientSelection).toBe("all");
  });

  test("Manage clients opens the Clients screen", async () => {
    const { store } = await open([]);
    await openPalette();
    await click(palette("Gerenciar clientes"));
    expect(store.router.current).toEqual({ name: "clients" });
  });
});

describe("clients-ui: Settings", () => {
  test("it has one line that leads to the Clients screen, with no client defined too", async () => {
    const { store } = await open([]);
    await act(async () => store.router.push({ name: "settings" }));
    await settle(() => screen.queryByRole("heading", { name: "Configurações" }) !== null);
    const panel = screen.queryByRole("button", { name: "Gerenciar clientes" });
    expect(panel).not.toBeNull();
    await click(panel);
    expect(store.router.current).toEqual({ name: "clients" });
  });
});
