import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Budgets } from "../../daemon/src/costs/budgets.ts";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);

const client = (id: string, name: string, pattern: string) => ({
  id,
  name,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});

const section = () => screen.queryByRole("region", { name: "Orçamentos de alfa" });
const rows = () =>
  [...(section()?.querySelectorAll("li [data-row-title]") ?? [])].map((t) => t.textContent ?? "");

/** A host with a budget of its own and one for a project of each client, open on Settings. */
async function online() {
  let budgets: Budgets | null = null;
  const d = makeDaemon(cleanups, {
    costs: true,
    budgets: (db) => {
      budgets = new Budgets({ db, now: () => START, day: () => TODAY });
      return budgets;
    },
  });
  const made = budgets as unknown as Budgets;
  made.set({ scope: "host", period: "day", limitUsd: 50, action: "notify" });
  made.set({
    scope: "project",
    projectKey: "github.com/acme/api",
    period: "day",
    limitUsd: 10,
    action: "notify",
  });
  made.set({
    scope: "project",
    projectKey: "github.com/beta/app",
    period: "day",
    limitUsd: 20,
    action: "notify",
  });
  const platform = memoryPlatform(false);
  platform.items.set(
    CLIENTS_KEY,
    JSON.stringify({
      v: 1,
      clients: [
        client("acme", "Acme", "github.com/acme/*"),
        client("beta", "Beta", "github.com/beta/*"),
      ],
      overrides: {},
    }),
  );
  const store = new AppStore(platform.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
  });
  await settle(() => rows().length === 3);
  return { store };
}

describe("clients-filter: the Budgets section", () => {
  test("all clients lists every budget", async () => {
    await online();
    expect(rows()).toHaveLength(3);
    expect(screen.queryByText(/de outros clientes/)).toBeNull();
  });

  test("a client lists its projects' budgets and the host's own, and says how many it hides", async () => {
    const { store } = await online();
    await act(async () => store.setClientSelection("acme"));
    await settle(() => rows().length === 2);
    expect(rows()).toHaveLength(2);
    expect(rows().some((r) => r.startsWith("orçamento do host"))).toBe(true);
    expect(rows().some((r) => r.includes("api"))).toBe(true);
    expect(rows().some((r) => r.includes("app"))).toBe(false);
    expect(screen.queryByText("1 orçamento de outros clientes oculto.")).not.toBeNull();
  });

  test("Unassigned keeps only the host's own budget", async () => {
    const { store } = await online();
    await act(async () => store.setClientSelection(UNASSIGNED));
    await settle(() => rows().length === 1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.startsWith("orçamento do host")).toBe(true);
    expect(screen.queryByText("2 orçamentos de outros clientes ocultos.")).not.toBeNull();
  });
});
