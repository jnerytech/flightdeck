import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { settle, settleMaybe, uiIdle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);

const main = () => screen.queryByRole("main") as HTMLElement;
const text = () => main()?.textContent ?? "";

/** One host with costs and US$ 2 spent today; `gate` decides what each `costs.summary` read gets. */
async function setup(gate: { refuse: boolean; hold: Promise<void> | null }) {
  const d = makeDaemon(cleanups, { costs: true });
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('c1', 's', ?, ?, 'github.com/acme/api', 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, 2)`,
    )
    .run(`${TODAY}T12:00:00.000Z`, TODAY);
  const store = new AppStore(memoryPlatform().platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  cleanups.push(() => store.dispose());
  const ask = store.hostCommand.bind(store);
  (store as unknown as { hostCommand: unknown }).hostCommand = async (
    hostId: string,
    type: string,
    payload: unknown,
  ) => {
    if (type !== "costs.summary")
      return (ask as (...a: unknown[]) => unknown)(hostId, type, payload);
    await gate.hold;
    return gate.refuse ? null : (ask as (...a: unknown[]) => unknown)(hostId, type, payload);
  };
  render(<App store={store} />);
  await act(async () => {
    await store.roster.add({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => {
    const host = store.getState().hosts[0];
    return host?.status === "online" && Boolean(host.hostInfo);
  });
  await act(async () => {
    store.router.push({ name: "costs" });
  });
}

const retry = () => within(main()).queryByRole("button", { name: "Tentar de novo" });

// #4191: a refused read says so and offers another try, and a changed question shows it is being read.
describe("custos-ui: leitura recusada e valores antigos (#4191)", () => {
  test("com o host recusando, mostra o erro com Tentar de novo, não o carregamento; ao tentar de novo, os valores aparecem", async () => {
    const gate = { refuse: true, hold: null };
    await setup(gate);
    expect(await settleMaybe(() => text().includes("Não foi possível ler os custos."))).toBe(true);
    expect(text()).toContain("Não foi possível ler os custos.");
    expect(retry()).not.toBeNull();
    expect(text().includes("Nenhum custo neste período")).toBe(false);
    expect(screen.queryByRole("status", { name: "Carregando custos" })).toBeNull();
    gate.refuse = false;
    await act(async () => {
      fireEvent.click(retry() as HTMLElement);
    });
    expect(await settleMaybe(() => text().includes("US$ 2,00"))).toBe(true);
    expect(text()).toContain("US$ 2,00");
    expect(text().includes("Não foi possível ler os custos.")).toBe(false);
  });

  test("ao mudar o período, os valores antigos ficam com o aviso de que estão sendo atualizados, até a resposta chegar", async () => {
    const gate: { refuse: boolean; hold: Promise<void> | null } = { refuse: false, hold: null };
    await setup(gate);
    expect(await settleMaybe(() => text().includes("US$ 2,00"))).toBe(true);
    expect(text().includes("Atualizando os valores")).toBe(false);
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => {
      fireEvent.click(within(main()).getByRole("button", { name: "30 dias" }));
    });
    expect(await settleMaybe(() => text().includes("Atualizando os valores"))).toBe(true);
    expect(text()).toContain("Atualizando os valores");
    expect(text()).toContain("US$ 2,00");
    await act(async () => release());
    await uiIdle();
    expect(await settleMaybe(() => !text().includes("Atualizando os valores"))).toBe(true);
    expect(text().includes("Atualizando os valores")).toBe(false);
    expect(text()).toContain("US$ 2,00");
  });
});
