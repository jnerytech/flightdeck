import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Budgets } from "../../daemon/src/costs/budgets.ts";
import { CLIENT_BUDGET_ALERTS_KEY } from "../src/lib/client-budgets.ts";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);
let seq = 0;

const client = (id: string, name: string, pattern: string) => ({
  id,
  name,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});

/** Acme spent 2 (on alfa) and Beta 3 (on beta) this month; Acme's limit is 4, Beta's 3. */
async function setup(budgets: Record<string, number> = { acme: 4, beta: 3 }) {
  const spend = (d: ReturnType<typeof makeDaemon>, key: string, cost: number) =>
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      )
      .run(`k${++seq}`, `${TODAY}T12:00:00.000Z`, TODAY, key, cost);
  let hostBudgets: Budgets | null = null;
  const alfa = makeDaemon(cleanups, {
    costs: true,
    budgets: (db) => {
      hostBudgets = new Budgets({ db, now: () => START, day: () => TODAY });
      return hostBudgets;
    },
  });
  const beta = makeDaemon(cleanups, { costs: true });
  spend(alfa, "github.com/acme/api", 2);
  spend(beta, "github.com/beta/app", 3);
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
      budgets,
    }),
  );
  const store = new AppStore(platform.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
    await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
  return { store, platform, hostBudgets: hostBudgets as unknown as Budgets };
}

const bodies = (platform: ReturnType<typeof memoryPlatform>) =>
  platform.notifications.map((n) => n.body);

describe("clients-budgets: the app watches a client's month limit", () => {
  test("it judges each client's spend across hosts against its limit", async () => {
    const { store } = await setup();
    await act(() => store.checkClientBudgets());
    const states = store.getState().clientBudgets;
    expect(states.map((s) => [s.clientId, s.spentUsd, s.limitUsd])).toEqual([
      ["acme", 2, 4],
      ["beta", 3, 3],
    ]);
    expect(states.map((s) => s.crossed)).toEqual([[0.5], [0.5, 0.8, 1]]);
  });

  test("each threshold notifies once, and a second look says nothing new", async () => {
    const { store, platform } = await setup();
    await act(() => store.checkClientBudgets());
    expect(bodies(platform)).toEqual([
      "Orçamento do cliente Acme: 50% de US$ 4.00 no mês",
      "Orçamento do cliente Beta: 50% de US$ 3.00 no mês",
      "Orçamento do cliente Beta: 80% de US$ 3.00 no mês",
      "Orçamento do cliente Beta: 100% de US$ 3.00 no mês",
    ]);
    await act(() => store.checkClientBudgets());
    expect(platform.notifications).toHaveLength(4);
  });

  test("what was announced before a restart is not announced again", async () => {
    const { store, platform } = await setup();
    platform.items.set(
      CLIENT_BUDGET_ALERTS_KEY,
      JSON.stringify({ "acme|2026-10": [0.5], "beta|2026-10": [0.5, 0.8, 1] }),
    );
    await act(() => store.checkClientBudgets());
    expect(platform.notifications).toEqual([]);
    expect(store.getState().clientBudgets.map((s) => s.crossed)).toEqual([[0.5], [0.5, 0.8, 1]]);
  });

  test("the crossed budgets are in Needs you, which counts them", async () => {
    const { store } = await setup();
    await act(() => store.checkClientBudgets());
    await act(async () => store.router.push({ name: "needs-you" }));
    await settle(() => screen.queryByText(/Orçamento do cliente Beta: 100%/) !== null);
    expect(screen.queryByText("Orçamento do cliente Acme: 50% de US$ 4.00 no mês") !== null).toBe(
      true,
    );
    expect(screen.queryByText("Orçamento do cliente Beta: 100% de US$ 3.00 no mês") !== null).toBe(
      true,
    );
  });

  test("nothing is held on the hosts: no budget is created there", async () => {
    const { store, hostBudgets } = await setup();
    await act(() => store.checkClientBudgets());
    expect(hostBudgets.list()).toEqual([]);
  });

  test("with no limit set there is nothing to judge, and a removed limit takes its alert away", async () => {
    const { store } = await setup({});
    await act(() => store.checkClientBudgets());
    expect(store.getState().clientBudgets).toEqual([]);
    await act(async () => {
      store.clients.setBudget("beta", 3);
    });
    await act(() => store.checkClientBudgets());
    expect(store.getState().clientBudgets).toHaveLength(1);
    await act(async () => {
      store.clients.clearBudget("beta");
    });
    await act(() => store.checkClientBudgets());
    expect(store.getState().clientBudgets).toEqual([]);
  });

  test("setting a limit makes the app look at once", async () => {
    const { store, platform } = await setup({});
    await act(async () => {
      store.clients.setBudget("beta", 3);
    });
    await settle(() => store.getState().clientBudgets.length === 1);
    expect(store.getState().clientBudgets[0]?.crossed).toEqual([0.5, 0.8, 1]);
    await settle(() => platform.notifications.length === 3);
    expect(platform.notifications).toHaveLength(3);
  });
});
