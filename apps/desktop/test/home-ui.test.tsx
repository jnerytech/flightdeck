import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Budget, CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySummary } = await import("../src/lib/client-costs.ts");
const { HomePage } = await import("../src/ui/HomePage.tsx");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const budget: Budget = {
  id: "b",
  scope: "host",
  projectKey: null,
  period: "month",
  limitUsd: 150,
  action: "notify",
  createdAt: "",
  periodKey: "2026-10",
  spentUsd: 40,
  fraction: 0.27,
  crossed: [],
};

function costs(): CostsSummary {
  const summary = emptySummary("2026-10-04", "2026-10-10");
  summary.byDay = [
    { day: "2026-10-09", projectKey: "p", costUsd: 0.5, tokens: 1_000_000 },
    { day: "2026-10-10", projectKey: "p", costUsd: 1.75, tokens: 1_200_000 },
  ];
  summary.totals.costUsd = 2.25;
  Object.assign(summary.totals.tokens, {
    input: 100_000,
    output: 100_000,
    cacheRead: 1_900_000,
    cacheWrite5m: 100_000,
  });
  return summary;
}

const usage = (extra: Record<string, number> | null): UsageSummary => ({
  days: 7,
  rows: [
    {
      day: "2026-10-10",
      projectKey: "p",
      costUsd: 0.7,
      inputTokens: 1,
      outputTokens: 1,
      turns: 4,
      ...(extra ?? {}),
    },
  ],
});

function setup(
  options: { hosts?: number; usage?: UsageSummary; refuse?: string; refreshMs?: number } = {},
) {
  const store = new AppStore(memoryPlatform(false, "en").platform, {
    baseDelayMs: 600_000,
    day: () => "2026-10-10",
  });
  store.i18n.start();
  const asked: string[] = [];
  // Home reads silently: a refusal comes back as a result, never as a banner.
  store.hostRequest = (async (hostId: string, command: string) => {
    asked.push(`${hostId}:${command}`);
    if (`${hostId}:${command}` === options.refuse) {
      return { ok: false, code: "internal", message: "no" };
    }
    if (command === "costs.summary") return { ok: true, data: costs() };
    if (command === "usage.summary") {
      return { ok: true, data: options.usage ?? usage({ failedTurns: 1, durationMs: 18_000 }) };
    }
    return { ok: false, code: "internal", message: "no" };
  }) as never;
  const hosts = Array.from({ length: options.hosts ?? 1 }, (_, i) => ({
    id: `h${i + 1}`,
    name: `host${i + 1}`,
    status: "online",
    hostInfo: { daemonVersion: "x", features: ["costs"] },
    sessions: [],
  }));
  const state = {
    ...store.getState(),
    hosts,
    budgets: { h1: [budget] },
  } as never as ReturnType<typeof store.getState>;
  const routes: unknown[] = [];
  const view = (
    <HomePage
      store={store}
      state={state}
      go={(route) => void routes.push(route)}
      {...(options.refreshMs ? { refreshMs: options.refreshMs } : {})}
    />
  );
  return { view, routes, asked, store };
}

describe("home-ui: four cards with the last seven days of every host", () => {
  test("spend, turns, tokens and the average turn, each with its number first and what goes with it", async () => {
    const { view } = setup();
    render(view);
    const spend = await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(spend.textContent).toContain("$2.25"));
    expect(spend.textContent).toContain("$40.00 of $150.00 budget this month");
    const turns = screen.getByRole("button", { name: "Open Turns" });
    expect(turns.textContent).toContain("4");
    expect(turns.textContent).toContain("3 ok");
    expect(turns.textContent).toContain("1 failed");
    const tokens = screen.getByRole("button", { name: "Open Tokens" });
    expect(tokens.textContent).toContain("2.2M");
    expect(tokens.textContent).toContain("1.9M cache read");
    const average = screen.getByRole("button", { name: "Open Avg cost / turn" });
    expect(average.textContent).toContain("$0.18");
    expect(average.textContent).toContain("4.5 s");
    expect(average.textContent).toContain("75% success rate");
  });

  test("a screen reader hears each card's number and details: they are the button's description (HK-M3)", async () => {
    const { view } = setup();
    render(view);
    const spend = await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(spend.textContent).toContain("$2.25"));
    const description = (button: HTMLElement) =>
      (button.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    expect(description(spend)).toContain("$2.25");
    expect(description(spend)).toContain("$40.00 of $150.00 budget this month");
    expect(description(screen.getByRole("button", { name: "Open Turns" }))).toContain("3 ok");
    expect(description(screen.getByRole("button", { name: "Open Tokens" }))).toContain("2.2M");
    expect(description(screen.getByRole("button", { name: "Open Avg cost / turn" }))).toContain(
      "75% success rate",
    );
  });

  test("each card draws its seven days as a sparkline that says its values", async () => {
    const { view } = setup();
    render(view);
    const chart = await screen.findByRole("img", { name: /^Spend, last 7 days: / });
    expect(chart.getAttribute("aria-label")).toContain("1.75");
    expect(screen.getAllByRole("img").length).toBe(4);
  });

  test("a card opens the screen it summarizes", async () => {
    const { view, routes } = setup();
    render(view);
    await screen.findByRole("button", { name: "Open Spend" });
    for (const name of ["Open Spend", "Open Tokens", "Open Avg cost / turn"]) {
      await act(async () => void fireEvent.click(screen.getByRole("button", { name })));
    }
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Open Turns" })));
    expect(routes).toEqual([
      { name: "costs" },
      { name: "costs" },
      { name: "costs" },
      { name: "history", host: "h1" },
    ]);
  });

  test("a host that does not count failed turns leaves them unknown, never zero", async () => {
    const { view } = setup({ usage: usage(null) });
    render(view);
    const turns = await screen.findByRole("button", { name: "Open Turns" });
    await waitFor(() => expect(turns.textContent).toContain("4"));
    expect(turns.textContent).not.toContain("failed");
    expect(screen.getByRole("button", { name: "Open Avg cost / turn" }).textContent).toContain("—");
  });

  test("a turn that takes over a minute is read in minutes, and the numbers follow the language", async () => {
    const { view } = setup({ usage: usage({ failedTurns: 0, durationMs: 360_000 }) });
    render(view);
    const average = await screen.findByRole("button", { name: "Open Avg cost / turn" });
    await waitFor(() => expect(average.textContent).toContain("1 min"));
    expect(average.textContent).toContain("100% success rate");
  });

  test("every online host is asked once for its costs and its usage", async () => {
    const { view, asked } = setup({ hosts: 2 });
    render(view);
    await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(asked.length).toBe(4));
    expect(asked.sort()).toEqual([
      "h1:costs.summary",
      "h1:usage.summary",
      "h2:costs.summary",
      "h2:usage.summary",
    ]);
  });

  test("with no host connected it says so, and shows no cards", () => {
    const { view } = setup({ hosts: 0 });
    render(view);
    expect(screen.getByText("No host is connected yet.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open Spend" })).toBeNull();
  });
});

describe("home-ui: Home is a screen of the app", () => {
  test("opening the route shows Home in the page and its tab, and the bar marks it", async () => {
    const cleanups: Array<() => unknown> = [];
    const server = makeDaemon(cleanups, {}).listen();
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    });
    await pollFor(() => store.getState().hosts[0]?.status === "online" || undefined, "online");
    await act(async () => {
      store.tabs.open({ name: "overview" });
    });
    expect(await screen.findByRole("heading", { name: "Home" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Home/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  test("a host that does not answer is named, the others still count, and no banner is raised (HK-M2)", async () => {
    const { view, store } = setup({ hosts: 2, refuse: "h2:usage.summary" });
    render(view);
    const spend = await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(spend.textContent).toContain("$4.50"));
    expect(screen.getByText("Some hosts did not answer: host2.")).toBeTruthy();
    expect(store.getState().notices).toHaveLength(0);
  });

  test("a daemon without the Home counters is told, not shown as zero (HK-M2)", async () => {
    const { view } = setup({ usage: usage(null) });
    render(view);
    await screen.findByRole("button", { name: "Open Turns" });
    expect(
      await screen.findByText("Failed turns and turn time need a daemon with the Home counters."),
    ).toBeTruthy();
  });

  test("while the hosts are asked the page says it is loading, and stops saying it after (HK-M2)", async () => {
    const { view } = setup();
    render(view);
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    await screen.findByRole("button", { name: "Open Spend" });
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  test("the numbers are read again when the window gets focus back and on a timer (HK-M2)", async () => {
    const { view, asked } = setup({ refreshMs: 40 });
    render(view);
    await screen.findByRole("button", { name: "Open Spend" });
    const first = asked.length;
    await waitFor(() => expect(asked.length).toBeGreaterThan(first));
    const second = asked.length;
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(asked.length).toBeGreaterThan(second));
  });
});
