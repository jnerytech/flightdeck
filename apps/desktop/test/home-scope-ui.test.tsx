import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { UsageSummary } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySummary } = await import("../src/lib/client-costs.ts");
const { DATA_SCOPE_KEY } = await import("../src/lib/data-scope.ts");
const { HomePage } = await import("../src/ui/HomePage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** What each host spent on the last day of the week. */
const SPENT: Record<string, number> = { h1: 2, h2: 5 };
const usage: UsageSummary = { days: 7, rows: [] };

function setup(
  options: { language?: "en" | "pt-BR"; kept?: string; offline?: string; hosts?: string[] } = {},
) {
  const platform = memoryPlatform(false, options.language ?? "en").platform;
  if (options.kept) platform.storage.setItem(DATA_SCOPE_KEY, options.kept);
  const store = new AppStore(platform, { baseDelayMs: 600_000, day: () => "2026-10-10" });
  store.i18n.start();
  const asked: string[] = [];
  store.hostRequest = (async (hostId: string, command: string, payload: unknown) => {
    asked.push(hostId);
    if (command === "usage.summary") return { ok: true, data: usage };
    const { from, to } = payload as { from: string; to: string };
    const summary = emptySummary(from, to);
    const spent = SPENT[hostId] ?? 0;
    summary.byDay = [{ day: "2026-10-10", projectKey: "p", costUsd: spent, tokens: 10 }];
    summary.totals.costUsd = spent;
    return { ok: true, data: summary };
  }) as never;
  const names: Record<string, string> = { h1: "alfa", h2: "beta" };
  const hosts = (options.hosts ?? ["h1", "h2"]).map((id) => ({
    id,
    name: names[id],
    status: options.offline === id ? "offline" : "online",
    hostInfo: { daemonVersion: "x", features: ["costs"] },
    sessions: [],
  }));
  const state = {
    ...store.getState(),
    hosts,
    hostsLoaded: true,
    budgets: {},
  } as never as ReturnType<typeof store.getState>;
  render(<HomePage store={store} state={state} go={() => {}} />);
  return { store, asked, storage: platform.storage };
}

/** The Spend card's text, or "" before it is there. */
const spend = (name = "Open Spend") => screen.queryByRole("button", { name })?.textContent ?? "";
const pick = async (menu: string, item: string) => {
  const trigger = screen.queryByRole("button", { name: menu });
  if (!trigger) return;
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  const entry = screen.queryByRole("menuitemradio", { name: item });
  if (!entry) return;
  await act(async () => {
    fireEvent.click(entry);
  });
};

describe("home-scope-ui: Home adds up the hosts in the data scope (#126)", () => {
  test("All hosts adds both; picking alfa adds alfa only, asks beta nothing more, and says so", async () => {
    const { asked, storage } = setup();
    await settle(() => /\$7\.00/.test(spend()));
    const all = /\$7\.00/.test(spend());
    await pick("Data from All hosts", "alfa");
    const since = asked.length;
    await settleMaybe(() => /\$2\.00/.test(spend()));
    expect({
      all,
      alfa: /\$2\.00/.test(spend()),
      betaAsked: asked.slice(since).includes("h2"),
      menu: screen.queryByRole("button", { name: "Data from alfa" }) !== null,
      said: screen.queryByText("Showing alfa") !== null,
      kept: storage.getItem(DATA_SCOPE_KEY),
    }).toEqual({
      all: true,
      alfa: true,
      betaAsked: false,
      menu: true,
      said: true,
      kept: '{"kind":"host","hostId":"h1"}',
    });
  });

  test("a kept scope whose host is offline says so and offers every host", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}', offline: "h1" });
    await settleMaybe(() => screen.queryByText(/alfa is offline/) !== null);
    const said = screen.queryByText(/alfa is offline/) !== null;
    const all = screen.queryByRole("button", { name: "Show all hosts" });
    if (all) {
      await act(async () => {
        fireEvent.click(all);
      });
    }
    await settleMaybe(() => /\$5\.00/.test(spend()));
    expect({ said, offered: all !== null, beta: /\$5\.00/.test(spend()) }).toEqual({
      said: true,
      offered: true,
      beta: true,
    });
  });

  test("with a single host there is no scope to pick", async () => {
    setup({ hosts: ["h1"] });
    await settle(() => /\$2\.00/.test(spend()));
    expect(screen.queryByRole("button", { name: /^Data from/ })).toBeNull();
  });

  test("em português", async () => {
    setup({ language: "pt-BR" });
    await settle(() => spend("Abrir Gasto") !== "");
    await pick("Dados de Todos os hosts", "beta");
    await settleMaybe(() => screen.queryByText("Mostrando beta") !== null);
    expect({
      said: screen.queryByText("Mostrando beta") !== null,
      menu: screen.queryByRole("button", { name: "Dados de beta" }) !== null,
    }).toEqual({ said: true, menu: true });
  });
});
