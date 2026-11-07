import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { DATA_SCOPE_KEY } from "../src/lib/data-scope.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
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

const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);
let seq = 0;

const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

/** Two hosts with costs (alfa spent 2, beta 5) and one that reports none (gama); the app on Home. */
async function setup(kept?: unknown) {
  const spend = (d: ReturnType<typeof makeDaemon>, cost: number) =>
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, 'github.com/x/y', 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      )
      .run(`s${++seq}`, `${TODAY}T12:00:00.000Z`, TODAY, cost);
  const alfa = makeDaemon(cleanups, { costs: true });
  const beta = makeDaemon(cleanups, { costs: true });
  const gama = legacyDaemon(cleanups);
  spend(alfa, 2);
  spend(beta, 5);
  const platform = memoryPlatform(false);
  seedDemoHosts(platform.win.localStorage, platform.tokens, [
    { id: "ha", name: "alfa", url: alfa.listen().url, token: TOKEN },
    { id: "hb", name: "beta", url: beta.listen().url, token: TOKEN },
    { id: "hc", name: "gama", url: gama.url, token: TOKEN },
  ]);
  if (kept !== undefined) platform.items.set(DATA_SCOPE_KEY, JSON.stringify(kept));
  const store = new AppStore(platform.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  render(<App store={store} />);
  await settle(
    () =>
      store.getState().hosts.length === 3 &&
      store.getState().hosts.every((h) => h.hostInfo != null),
  );
  return { store, saved: platform.saved };
}

const total = () =>
  (screen.queryByLabelText("Custo estimado") as HTMLElement | null)?.textContent ?? null;
const menu = (scope: string) =>
  screen.queryByRole("button", { name: fill(ptBR.scope.menu, { scope }) });
const exportButton = () => screen.queryByRole("button", { name: "Exportar CSV" });

/** Opens the scope menu and picks a host (or every host) from it. */
async function pick(current: string, choice: string) {
  const trigger = menu(current) as HTMLElement;
  expect(trigger === null).toBe(false);
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  const item = await screen.findByRole("menuitemradio", { name: choice });
  await act(async () => {
    fireEvent.click(item);
  });
}

// Issue #126, slice 3: Costs follows the data scope instead of a host choice of its own.
describe("costs-scope: the Costs screen reads the data scope", () => {
  test("with no scope kept it adds every host up, under the scope menu, with no host select of its own", async () => {
    const { store } = await setup();
    await act(async () => store.router.push({ name: "costs" }));
    await settle(() => total() === "US$ 7.00");
    expect(total()).toBe("US$ 7.00");
    expect(menu(ptBR.scope.all) === null).toBe(false);
    expect(screen.queryByLabelText("Host dos custos") === null).toBe(true);
  });

  test("choosing a host in the menu scopes the screen to it, and the scope is the store's", async () => {
    const { store } = await setup();
    await act(async () => store.router.push({ name: "costs" }));
    await settle(() => total() === "US$ 7.00");
    await pick(ptBR.scope.all, "alfa");
    await settle(() => total() === "US$ 2.00");
    expect(total()).toBe("US$ 2.00");
    expect(store.dataScope.value).toEqual({ kind: "host", hostId: "ha" });
    expect(exportButton() === null).toBe(false);
  });

  test("a scope kept from the last run is what the screen opens on", async () => {
    const { store } = await setup({ kind: "host", hostId: "hb" });
    await act(async () => store.router.push({ name: "costs" }));
    await settle(() => total() === "US$ 5.00");
    expect(total()).toBe("US$ 5.00");
    expect(menu("beta") === null).toBe(false);
  });

  test("a route's host wins for that visit and never rewrites the scope; picking in the menu ends it", async () => {
    const { store } = await setup();
    await act(async () => store.dataScope.set({ kind: "host", hostId: "ha" }));
    await act(async () => store.router.push({ name: "costs", host: "hb" }));
    await settle(() => total() === "US$ 5.00");
    expect(total()).toBe("US$ 5.00");
    expect(menu("beta") === null).toBe(false);
    expect(store.dataScope.value).toEqual({ kind: "host", hostId: "ha" });
    await pick("beta", "alfa");
    await settle(() => total() === "US$ 2.00");
    expect(total()).toBe("US$ 2.00");
    expect(menu("alfa") === null).toBe(false);
  });

  test("a scoped host that reports no costs gets a notice and no numbers, and Show all hosts brings them back", async () => {
    const { store } = await setup();
    await act(async () => store.dataScope.set({ kind: "host", hostId: "hc" }));
    await act(async () => store.router.push({ name: "costs" }));
    await settle(
      () =>
        screen.queryByText(fill(ptBR.scope.noCosts, { host: "gama" }), { exact: false }) !== null,
    );
    expect(total() === null).toBe(true);
    const all = screen.queryByRole("button", { name: ptBR.scope.showAll });
    expect(all === null).toBe(false);
    await act(async () => {
      fireEvent.click(all as HTMLElement);
    });
    await settle(() => total() === "US$ 7.00");
    expect(total()).toBe("US$ 7.00");
    expect(store.dataScope.value).toEqual({ kind: "all" });
  });

  test("on All hosts the CSV export covers every host, with the host's name as its first column", async () => {
    const { store, saved } = await setup();
    await act(async () => store.router.push({ name: "costs" }));
    await settle(() => total() === "US$ 7.00");
    const button = exportButton();
    expect(button === null).toBe(false);
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    await settle(() => saved.length === 1);
    const lines = (saved[0]?.text ?? "").split("\n");
    expect(lines[0]?.startsWith("host,day,")).toBe(true);
    expect(lines.filter((line) => line.startsWith("alfa,")).length).toBe(1);
    expect(lines.filter((line) => line.startsWith("beta,")).length).toBe(1);
  });

  test("on All hosts the quota is one line asking for a host, with a button per host that scopes the screen", async () => {
    const { store } = await setup();
    await act(async () => store.router.push({ name: "costs" }));
    await settle(() => total() === "US$ 7.00");
    expect(screen.queryByText(ptBR.costsUi.quotaPick) === null).toBe(false);
    const alfa = screen.queryByRole("button", { name: "alfa" });
    expect(alfa === null).toBe(false);
    await act(async () => {
      fireEvent.click(alfa as HTMLElement);
    });
    await settle(() => total() === "US$ 2.00");
    expect(store.dataScope.value).toEqual({ kind: "host", hostId: "ha" });
    expect(screen.queryByText(ptBR.costsUi.quotaPick) === null).toBe(true);
  });
});
