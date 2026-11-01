import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
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

const client = (id: string, name: string, pattern: string) => ({
  id,
  name,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});

/** Acme spent 2 (on alfa) and Beta 3 (on beta) this month; Acme's limit is 4, Beta's 3. */
async function setup(budgets: Record<string, number> = {}) {
  const spend = (d: ReturnType<typeof makeDaemon>, key: string, cost: number) =>
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      )
      .run(`k${++seq}`, `${TODAY}T12:00:00.000Z`, TODAY, key, cost);
  const alfa = makeDaemon(cleanups, { costs: true });
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
  await act(async () => store.router.push({ name: "clients" }));
  await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
  return { store, platform };
}

const itemOf = (name: string) => {
  const found = [...document.querySelectorAll("li")].find(
    (li) => li.querySelector("[data-client-name]")?.textContent === name,
  );
  expect(found).toBeDefined();
  return found as HTMLElement;
};
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
const limitField = (name: string) => {
  const found = within(itemOf(name)).queryByLabelText("Limite mensal (US$)");
  expect(found).not.toBeNull();
  return found as HTMLInputElement;
};
const typeLimit = async (name: string, value: string) => {
  await act(async () => {
    fireEvent.change(limitField(name), { target: { value } });
  });
};
const line = (name: string) =>
  itemOf(name).querySelector("[data-budget-line]")?.textContent ?? null;

describe("clients-budgets: the month limit on the Clients screen", () => {
  test("a limit is set from the client's own field, and said in a line", async () => {
    const { store } = await setup();
    expect(line("Acme")).toBeNull();
    await typeLimit("Acme", "120");
    await click(within(itemOf("Acme")).queryByRole("button", { name: "Definir orçamento" }));
    expect(store.clients.budgets()).toEqual({ acme: 120 });
    expect(limitField("Acme").value).toBe("");
    await settle(() => line("Acme") !== null);
    expect(line("Acme")).toMatch(/US\$ 120\.00/);
  });

  test("a limit that is blank or not above zero cannot be set, and the field says why", async () => {
    await setup();
    const button = () =>
      within(itemOf("Acme")).queryByRole("button", {
        name: "Definir orçamento",
      }) as HTMLButtonElement;
    await typeLimit("Acme", "0");
    expect(button().disabled).toBe(true);
    expect(within(itemOf("Acme")).queryByText("Informe um limite maior que zero.") !== null).toBe(
      true,
    );
    await typeLimit("Acme", "");
    expect(button().disabled).toBe(true);
  });

  test("once looked at, the line says what was spent against the limit", async () => {
    const { store } = await setup({ acme: 4 });
    await act(() => store.checkClientBudgets());
    await settle(() => line("Acme")?.includes("50%") === true);
    expect(line("Acme")).toBe("Este mês: US$ 2.00 de US$ 4.00 (50%)");
    expect(line("Beta")).toBeNull();
  });

  test("the screen says the limit only warns, and a limit is removed", async () => {
    const { store } = await setup({ acme: 4 });
    expect(within(itemOf("Acme")).queryByText(/Não segura cards/) !== null).toBe(true);
    await click(
      within(itemOf("Acme")).queryByRole("button", { name: "Remover orçamento de Acme" }),
    );
    expect(store.clients.budgets()).toEqual({});
    expect(line("Acme")).toBeNull();
  });

  test("changing a limit replaces it", async () => {
    const { store } = await setup({ acme: 4 });
    await typeLimit("Acme", "9");
    await click(within(itemOf("Acme")).queryByRole("button", { name: "Salvar orçamento" }));
    expect(store.clients.budgets()).toEqual({ acme: 9 });
  });
});
