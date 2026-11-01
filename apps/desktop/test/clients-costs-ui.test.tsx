import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

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
const TWO = [
  client("acme", "Acme", "github.com/acme/*"),
  client("beta", "Beta", "github.com/beta/*"),
];

/** Two hosts with costs: alfa spent 2 on Acme's project and 1 on one nobody claims, beta spent 3 on Beta's. */
async function setup(clients: unknown[] = TWO) {
  const spend = (d: ReturnType<typeof makeDaemon>, key: string, cost: number) =>
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      )
      .run(`c${++seq}`, `${TODAY}T12:00:00.000Z`, TODAY, key, cost);
  const alfa = makeDaemon(cleanups, { costs: true });
  const beta = makeDaemon(cleanups, { costs: true });
  spend(alfa, "github.com/acme/api", 2);
  spend(alfa, "github.com/other/x", 1);
  spend(beta, "github.com/beta/app", 3);
  const platform = memoryPlatform(false);
  platform.items.set(CLIENTS_KEY, JSON.stringify({ v: 1, clients, overrides: {} }));
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
  await act(async () => store.router.push({ name: "costs" }));
  await settle(() => screen.queryByLabelText("Host dos custos") !== null);
  return { store };
}

const total = () =>
  (screen.queryByLabelText("Custo estimado") as HTMLElement | null)?.textContent ?? null;
const rowsOf = (name: string) =>
  [...(screen.queryByRole("region", { name })?.querySelectorAll("tr") ?? [])].map(
    (tr) => tr.textContent ?? "",
  );
async function pickHost(value: string) {
  const select = screen.queryByLabelText("Host dos custos");
  expect(select).not.toBeNull();
  await act(async () => {
    fireEvent.change(select as HTMLElement, { target: { value } });
  });
}
const hostOptions = () =>
  [
    ...((screen.queryByLabelText("Host dos custos") as HTMLSelectElement | null)?.options ?? []),
  ].map((o) => o.text);

describe("clients-costs: the Costs screen across hosts", () => {
  test("it keeps the first host by default, and offers all hosts when there are several", async () => {
    await setup();
    expect(hostOptions()).toEqual(["alfa", "beta", "Todos os hosts"]);
    await settle(() => total() === "US$ 3.00");
    expect(total()).toBe("US$ 3.00");
  });

  test("all hosts adds the hosts up, and splits the spend by client, with what no client claims", async () => {
    await setup();
    await pickHost("__all__");
    await settle(() => total() === "US$ 6.00");
    expect(total()).toBe("US$ 6.00");
    await settle(() => rowsOf("Por cliente").length === 3);
    const rows = rowsOf("Por cliente");
    expect(rows).toEqual(["BetaUS$ 3.00", "AcmeUS$ 2.00", "Sem clienteUS$ 1.00"]);
  });

  test("one host splits its own spend by client too", async () => {
    await setup();
    await settle(() => rowsOf("Por cliente").length === 2);
    expect(rowsOf("Por cliente")).toEqual(["AcmeUS$ 2.00", "Sem clienteUS$ 1.00"]);
  });

  test("the selected client narrows the totals and the breakdowns, and the split by client is not shown", async () => {
    const { store } = await setup();
    await pickHost("__all__");
    await settle(() => total() === "US$ 6.00");
    await act(async () => store.setClientSelection("beta"));
    await settle(() => total() === "US$ 3.00");
    expect(total()).toBe("US$ 3.00");
    expect(rowsOf("Por projeto")).toEqual(["github.com/beta/appUS$ 3.00"]);
    expect(screen.queryByRole("region", { name: "Por cliente" }) !== null).toBe(false);
    expect(screen.queryByText("Só o cliente Beta.") !== null).toBe(true);
    await act(async () => store.setClientSelection(UNASSIGNED));
    await settle(() => total() === "US$ 1.00");
    expect(total()).toBe("US$ 1.00");
  });

  test("with no client defined there is no split by client, and all hosts still adds up", async () => {
    await setup([]);
    await pickHost("__all__");
    await settle(() => total() === "US$ 6.00");
    expect(total()).toBe("US$ 6.00");
    expect(screen.queryByRole("region", { name: "Por cliente" }) !== null).toBe(false);
  });

  test("across hosts there is no CSV export, which is per host", async () => {
    await setup();
    expect(screen.queryByRole("button", { name: "Exportar CSV" }) !== null).toBe(true);
    await pickHost("__all__");
    await settle(() => total() === "US$ 6.00");
    expect(screen.queryByRole("button", { name: "Exportar CSV" }) !== null).toBe(false);
  });

  test("a host without costs is named as skipped, and one that does not answer as failed", async () => {
    const { store } = await setup();
    const plain = legacyDaemon(cleanups);
    const mute = legacyDaemon(cleanups);
    mute.features.push("costs");
    await act(async () => {
      await store.addHost({ name: "gama", url: plain.url, token: TOKEN });
      await store.addHost({ name: "delta", url: mute.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    await pickHost("__all__");
    await settle(() => screen.queryByText("Sem resposta de: delta.") !== null);
    expect(screen.queryByText("Sem resposta de: delta.") !== null).toBe(true);
    expect(screen.queryByText("Sem custos de: gama.") !== null).toBe(true);
    expect(total()).toBe("US$ 6.00");
  });
});
