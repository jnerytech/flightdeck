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
  options: {
    language?: "en" | "pt-BR";
    kept?: string;
    offline?: string;
    connecting?: string;
    incompatible?: string;
    hosts?: string[];
    /** Whether the host list was read yet (#212); read by default. */
    loaded?: boolean;
  } = {},
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
  const names: Record<string, string> = { h1: "alfa", h2: "beta", h3: "gama" };
  const hosts = (options.hosts ?? ["h1", "h2"]).map((id) => ({
    id,
    name: names[id],
    status:
      (
        [
          [options.offline, "offline"],
          [options.connecting, "connecting"],
          [options.incompatible, "incompatible"],
        ] as const
      ).find(([which]) => which === id)?.[1] ?? "online",
    hostInfo: { daemonVersion: "x", features: ["costs"] },
    sessions: [],
  }));
  const state = {
    ...store.getState(),
    hosts,
    hostsLoaded: options.loaded ?? true,
    budgets: {},
  } as never as ReturnType<typeof store.getState>;
  render(<HomePage store={store} state={state} go={() => {}} />);
  return { store, asked, storage: platform.storage };
}

/** The Spend card's text, or "" before it is there. */
const spend = (name = "Open Spend") => screen.queryByRole("button", { name })?.textContent ?? "";
const pick = async (menu: string, item: string) => {
  const trigger = screen.queryByRole("button", { name: menu });
  if (!trigger) throw new Error(`no menu named ${menu}`);
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  const entry = screen.queryByRole("menuitemradio", { name: item });
  if (!entry) throw new Error(`no item named ${item}`);
  await act(async () => {
    fireEvent.click(entry);
  });
};

describe("home-scope-ui: Home adds up the hosts in the data scope (#126)", () => {
  test("All hosts adds both; picking alfa adds alfa only, asks beta nothing more, and says so", async () => {
    const { asked, storage } = setup();
    await settle(() => /\$7\.00/.test(spend()));
    const all = /\$7\.00/.test(spend());
    const since = asked.length;
    await pick("Data from All hosts", "alfa");
    // alfa's numbers are on screen: the read that followed the pick is done.
    await settle(() => /\$2\.00/.test(spend()));
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

  // Review of #837: the page's subtitle says whose numbers they are, as the menu does.
  test("the subtitle names the scoped host, or every host", async () => {
    setup();
    await settle(() => /\$7\.00/.test(spend()));
    const all = screen.queryByText("Last 7 days · all hosts") !== null;
    await pick("Data from All hosts", "alfa");
    await settle(() => /\$2\.00/.test(spend()));
    expect({ all, alfa: screen.queryByText("Last 7 days · alfa") !== null }).toEqual({
      all: true,
      alfa: true,
    });
  });

  // #126 slice 4: Home does not read projects yet, so a project scope there is every host, said so.
  test("a kept project scope shows every host on Home, and the menu and subtitle say so", async () => {
    setup({ kept: '{"kind":"project","projectKey":"github.com/x/y"}' });
    await settleMaybe(() => /\$7\.00/.test(spend()));
    expect({
      spend: /\$7\.00/.test(spend()),
      subtitle: screen.queryByText("Last 7 days · all hosts") !== null,
      menu: screen.queryByRole("button", { name: "Data from All hosts" }) !== null,
    }).toEqual({ spend: true, subtitle: true, menu: true });
  });

  // Review of #837: a kept host missing from a list not read yet is not gone, so Home asks
  // nobody for numbers the person chose not to see; once the list is read without it, it is.
  test("a kept host not listed yet asks no host; once the list is read without it, Home adds up all", async () => {
    const early = setup({ kept: '{"kind":"host","hostId":"h1"}', hosts: ["h2"], loaded: false });
    await settleMaybe(() => early.asked.length > 0, 400);
    const before = [...early.asked];
    cleanup();
    setup({ kept: '{"kind":"host","hostId":"h1"}', hosts: ["h2"] });
    await settle(() => /\$5\.00/.test(spend()));
    expect({ before, after: /\$5\.00/.test(spend()) }).toEqual({ before: [], after: true });
  });

  // Review of #856: until the list is read, the kept host has no name to show, and "all hosts"
  // would mislead: the subtitle names no scope, and the menu waits for the list.
  test("before the host list is read, a kept host's scope is not called all hosts", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}', hosts: ["h2", "h3"], loaded: false });
    const all = () =>
      screen.queryByText("Last 7 days · all hosts") !== null ||
      screen.queryByRole("button", { name: "Data from All hosts" }) !== null;
    await settleMaybe(all, 300);
    expect({ all: all(), plain: screen.queryByText("Last 7 days") !== null }).toEqual({
      all: false,
      plain: true,
    });
  });

  // Review of #837: a scoped host still connecting is not offline; Home does not offer to leave it.
  test("a scoped host that is connecting offers no way out of the scope", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}', connecting: "h1" });
    const offered = () => screen.queryByRole("button", { name: "Show all hosts" }) !== null;
    await settleMaybe(offered, 400);
    expect({
      offered: offered(),
      menu: screen.queryByRole("button", { name: "Data from alfa" }) !== null,
    }).toEqual({ offered: false, menu: true });
  });

  // #886: an incompatible daemon is not offline; it needs an update.
  test("a kept scope whose host is incompatible asks for a daemon update", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}', incompatible: "h1" });
    const update = () => screen.queryByText(/alfa needs a daemon update/) !== null;
    await settleMaybe(update);
    expect({ update: update(), offline: screen.queryByText(/alfa is offline/) !== null }).toEqual({
      update: true,
      offline: false,
    });
  });

  test("a kept scope whose host is offline says so and offers every host", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}', offline: "h1" });
    await settle(() => screen.queryByText(/alfa is offline/) !== null);
    const said = screen.queryByText(/alfa is offline/) !== null;
    const all = screen.queryByRole("button", { name: "Show all hosts" });
    if (!all) throw new Error("no Show all hosts button");
    await act(async () => {
      fireEvent.click(all);
    });
    await settle(() => /\$5\.00/.test(spend()));
    expect({ said, offered: all !== null, beta: /\$5\.00/.test(spend()) }).toEqual({
      said: true,
      offered: true,
      beta: true,
    });
  });

  // Home already has one status region, read by its tests and by a screen reader as Home's state
  // (#212): the menu's announcement is a polite live region of its own, not a second status.
  test("the menu's announcement is not a second status region", async () => {
    setup();
    await settle(() => /\$7\.00/.test(spend()));
    await pick("Data from All hosts", "alfa");
    await settle(() => screen.queryByText("Showing alfa") !== null);
    const said = screen.queryByText("Showing alfa");
    expect({
      statuses: screen.queryAllByRole("status").length,
      live: said?.getAttribute("aria-live") ?? null,
    }).toEqual({ statuses: 1, live: "polite" });
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
