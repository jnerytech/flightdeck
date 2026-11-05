import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySummary } = await import("../src/lib/client-costs.ts");
const { HomePage } = await import("../src/ui/HomePage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const costs = (): CostsSummary => {
  const summary = emptySummary("2026-10-04", "2026-10-10");
  summary.byDay = [{ day: "2026-10-10", projectKey: "p", costUsd: 2, tokens: 1_000_000 }];
  summary.totals.costUsd = 2;
  Object.assign(summary.totals.tokens, { input: 400_000, output: 400_000, cacheRead: 200_000 });
  return summary;
};
const usage = (turns = 4): UsageSummary => ({
  days: 7,
  rows: [
    {
      day: "2026-10-10",
      projectKey: "p",
      costUsd: 0.8,
      inputTokens: 1,
      outputTokens: 1,
      turns,
      failedTurns: 0,
      durationMs: 10_000,
    },
  ],
});

interface HostOptions {
  id: string;
  status?: string;
  features?: string[];
}

function world(language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, {
    baseDelayMs: 600_000,
    day: () => "2026-10-10",
  });
  store.i18n.start();
  const asked: string[] = [];
  store.hostRequest = (async (hostId: string, command: string) => {
    asked.push(`${hostId}:${command}`);
    if (command === "costs.summary") return { ok: true, data: costs() };
    if (command === "usage.summary") return { ok: true, data: usage() };
    return { ok: false, code: "internal", message: "no" };
  }) as never;
  const routes: unknown[] = [];
  const view = (hosts: HostOptions[], over: object = {}) => {
    const state = {
      ...store.getState(),
      hosts: hosts.map((h) => ({
        id: h.id,
        name: `host-${h.id}`,
        status: h.status ?? "online",
        hostInfo: { daemonVersion: "x", features: h.features ?? ["costs"] },
        sessions: [],
      })),
      budgets: {},
      ...over,
    } as never as ReturnType<typeof store.getState>;
    return <HomePage store={store} state={state} go={(route) => void routes.push(route)} />;
  };
  return { store, asked, routes, view };
}

describe("home-followups: connecting at start is not 'no host' (issue #212)", () => {
  test("hosts that are still connecting say so, in a live region, and are busy", () => {
    const w = world();
    render(w.view([{ id: "h1", status: "connecting" }], { hostsLoaded: true }));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Connecting to your hosts…");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("No host is connected yet.")).toBeNull();
  });

  test("before the list of hosts is even read it is connecting too", () => {
    const w = world();
    render(w.view([], { hostsLoaded: false }));
    expect(screen.getByRole("status").textContent).toBe("Connecting to your hosts…");
  });

  test("hosts that are all offline or refused still say no host is connected", () => {
    const w = world();
    render(
      w.view(
        [
          { id: "h1", status: "offline" },
          { id: "h2", status: "unauthorized" },
        ],
        { hostsLoaded: true },
      ),
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("No host is connected yet.");
    expect(status.getAttribute("aria-busy")).toBeNull();
  });

  test("it is one live region from the first word to the numbers, so the swap is announced", async () => {
    const w = world();
    const first = render(w.view([{ id: "h1", status: "connecting" }], { hostsLoaded: true }));
    const region = screen.getByRole("status");
    first.rerender(w.view([{ id: "h1" }], { hostsLoaded: true }));
    await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(region.textContent).toBe("Home is ready."));
    expect(document.contains(region)).toBe(true);
    // Once the cards are there the words are for the ear only.
    expect(region.className).toContain("sr-only");
  });

  test("it reads in Portuguese", () => {
    const w = world("pt-BR");
    render(w.view([{ id: "h1", status: "connecting" }], { hostsLoaded: true }));
    expect(screen.getByRole("status").textContent).toBe("Conectando aos seus hosts…");
  });
});

describe("home-followups: hosts without costs show unknown, and Avg says where it comes from (issue #211)", () => {
  const spend = () => screen.getByRole("button", { name: "Open Spend" });
  const tokens = () => screen.getByRole("button", { name: "Open Tokens" });

  test("a host with no costs feature: Spend and Tokens read unknown, never $0, and it is not asked", async () => {
    const w = world();
    render(w.view([{ id: "h1", features: [] }], { hostsLoaded: true }));
    await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(w.asked).toContain("h1:usage.summary"));
    expect(spend().textContent).toContain("—");
    expect(spend().textContent).not.toContain("$0");
    expect(spend().textContent).toContain("No cost data from host-h1");
    expect(tokens().textContent).toContain("—");
    expect(w.asked.some((a) => a.endsWith("costs.summary"))).toBe(false);
    // The turns come from the usage counters every host has.
    expect(screen.getByRole("button", { name: "Open Turns" }).textContent).toContain("4");
  });

  test("with one host that has costs and one that has not, the numbers are the first's and the note names the other", async () => {
    const w = world();
    render(
      w.view(
        [
          { id: "h1", features: ["costs"] },
          { id: "h2", features: [] },
        ],
        { hostsLoaded: true },
      ),
    );
    await screen.findByRole("button", { name: "Open Spend" });
    await waitFor(() => expect(spend().textContent).toContain("$2.00"));
    expect(spend().textContent).toContain("No cost data from host-h2");
    expect(spend().textContent).not.toContain("host-h1");
    expect(tokens().textContent).toContain("1.0M");
  });

  test("when every host has costs there is no note", async () => {
    const w = world();
    render(w.view([{ id: "h1" }], { hostsLoaded: true }));
    await waitFor(() => expect(spend().textContent).toContain("$2.00"));
    expect(spend().textContent).not.toContain("No cost data");
  });

  test("the average says it counts managed sessions only, unlike Spend", async () => {
    const w = world();
    render(w.view([{ id: "h1" }], { hostsLoaded: true }));
    await waitFor(() => expect(spend().textContent).toContain("$2.00"));
    const average = screen.getByRole("button", { name: "Open Avg cost / turn" });
    expect(average.textContent).toContain("Managed sessions only");
  });

  test("it reads in Portuguese", async () => {
    const w = world("pt-BR");
    render(w.view([{ id: "h1", features: [] }], { hostsLoaded: true }));
    const card = await screen.findByRole("button", { name: "Abrir Gasto" });
    expect(card.textContent).toContain("Sem dados de custo de host-h1");
  });
});
