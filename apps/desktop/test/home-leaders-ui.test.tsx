import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySummary } = await import("../src/lib/client-costs.ts");
const { HomePage } = await import("../src/ui/HomePage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Shares = Pick<CostsSummary, "byProject" | "byModel" | "byPersona">;
const APP = "host:h1:/x/app";
const WEB = "host:h1:/x/web";

/** The week, then days 1-3 and days 4-6: app doubles, web halves, opus and no persona hold. */
const SHARES: Record<string, Shares> = {
  "2026-10-04|2026-10-10": {
    byProject: [
      { projectKey: APP, tokens: 600, costUsd: 1 },
      { projectKey: WEB, tokens: 400, costUsd: 1 },
    ],
    byModel: [
      { model: "opus", tokens: 700, costUsd: 2, priced: true },
      { model: "local", tokens: 300, costUsd: 0, priced: false },
    ],
    byPersona: [
      { persona: null, tokens: 800, costUsd: 1 },
      { persona: "reviewer", tokens: 200, costUsd: 1 },
    ],
  },
  "2026-10-04|2026-10-06": {
    byProject: [
      { projectKey: APP, tokens: 100, costUsd: 0 },
      { projectKey: WEB, tokens: 200, costUsd: 0 },
    ],
    byModel: [{ model: "opus", tokens: 300, costUsd: 0, priced: true }],
    byPersona: [{ persona: null, tokens: 300, costUsd: 0 }],
  },
  "2026-10-07|2026-10-09": {
    byProject: [
      { projectKey: APP, tokens: 200, costUsd: 0 },
      { projectKey: WEB, tokens: 100, costUsd: 0 },
    ],
    byModel: [
      { model: "opus", tokens: 300, costUsd: 0, priced: true },
      { model: "local", tokens: 50, costUsd: 0, priced: false },
    ],
    byPersona: [
      { persona: null, tokens: 300, costUsd: 0 },
      { persona: "reviewer", tokens: 50, costUsd: 0 },
    ],
  },
};

const usage: UsageSummary = { days: 7, rows: [] };

function setup(
  options: {
    language?: "en" | "pt-BR";
    empty?: boolean;
    costs?: boolean;
    /** While `now` is true every costs request is refused (the host is busy or went away). */
    failing?: { now: boolean };
    /** The costs requests for these ranges (`from|to`) are always refused. */
    refuse?: string[];
    refreshMs?: number;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
    day: () => "2026-10-10",
  });
  store.i18n.start();
  const ranges: string[] = [];
  store.hostRequest = (async (_hostId: string, command: string, payload: unknown) => {
    if (command === "usage.summary") return { ok: true, data: usage };
    const { from, to } = payload as { from: string; to: string };
    ranges.push(`${from}|${to}`);
    if (options.failing?.now || options.refuse?.includes(`${from}|${to}`)) {
      return { ok: false, code: "internal", message: "no" };
    }
    const summary = emptySummary(from, to);
    if (!options.empty) Object.assign(summary, SHARES[`${from}|${to}`]);
    return { ok: true, data: summary };
  }) as never;
  const hosts = [
    {
      id: "h1",
      name: "host1",
      status: "online",
      hostInfo: { daemonVersion: "x", features: options.costs === false ? [] : ["costs"] },
      sessions: [],
    },
  ];
  const state = {
    ...store.getState(),
    hosts,
    hostsLoaded: true,
    budgets: {},
  } as never as ReturnType<typeof store.getState>;
  const routes: unknown[] = [];
  render(
    <HomePage
      store={store}
      state={state}
      go={(route) => void routes.push(route)}
      {...(options.refreshMs ? { refreshMs: options.refreshMs } : {})}
    />,
  );
  return { routes, ranges };
}

const panel = (name: string) => screen.queryByRole("region", { name });
/** Whether each row of the shown list has the pieces a person reads in it; `null` with no panel. */
const rows = (name: string, pieces: string[][]) => {
  const region = panel(name);
  if (!region) return null;
  return within(region)
    .queryAllByRole("listitem")
    .map((item, i) => (pieces[i] ?? []).every((piece) => within(item).queryByText(piece) !== null));
};
const pick = async (name: string) => {
  const tab = screen.queryByRole("tab", { name });
  if (!tab) return;
  await act(async () => {
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  });
};
/** The cards come first; the leaderboard may follow, and the assertions say whether it did. */
const loaded = async (title: string) => {
  await settle(
    () =>
      screen.queryByRole("button", { name: "Open Spend" }) !== null ||
      screen.queryByRole("button", { name: "Abrir Gasto" }) !== null,
  );
  await settleMaybe(() => (panel(title)?.querySelectorAll("li").length ?? 0) > 0);
};

describe("home-leaders-ui: where the tokens of the 7 days went", () => {
  test("projects, models and personas, each row with its share, its tokens and its trend", async () => {
    setup();
    await loaded("Where the tokens went");
    const title = "Where the tokens went";
    const projects = rows(title, [
      ["app", "60%", "600 tokens", "Up 100%"],
      ["web", "40%", "400 tokens", "Down 50%"],
    ]);
    await pick("Models");
    const models = rows(title, [
      ["opus", "70%", "700 tokens", "Steady"],
      ["local", "30%", "300 tokens", "New"],
    ]);
    await pick("Personas");
    const personas = rows(title, [
      ["No persona", "80%", "800 tokens", "Steady"],
      ["reviewer", "20%", "200 tokens", "New"],
    ]);
    expect({ projects, models, personas }).toEqual({
      projects: [true, true],
      models: [true, true],
      personas: [true, true],
    });
  });

  test("a project opens Costs on that project over the 7 days", async () => {
    const { routes } = setup();
    await loaded("Where the tokens went");
    const open = screen.queryByRole("button", { name: "Open the costs of app" });
    if (open) {
      await act(async () => {
        fireEvent.click(open);
      });
    }
    expect(routes).toEqual([{ name: "costs", period: "7d", projectKey: APP }]);
  });

  test("a project's row names its folder in a tooltip, and its accessible name stays the short label", async () => {
    setup();
    await loaded("Where the tokens went");
    const open = screen.queryByRole("button", { name: "Open the costs of app" });
    expect(open === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(open?.getAttribute("title")).toBe("/x/app");
    expect(open?.textContent).toBe("app");
  });

  test("the trend reads the complete days: days 1-3, then days 4-6, never today", async () => {
    const { ranges } = setup();
    await loaded("Where the tokens went");
    expect([...ranges].sort()).toEqual([
      "2026-10-04|2026-10-06",
      "2026-10-04|2026-10-10",
      "2026-10-07|2026-10-09",
    ]);
  });

  test("em português, com a tendência em palavras", async () => {
    setup({ language: "pt-BR" });
    await loaded("Para onde foram os tokens");
    expect({
      tab: screen.queryByRole("tab", { name: "Projetos" })?.getAttribute("aria-selected") ?? null,
      rows: rows("Para onde foram os tokens", [
        ["app", "60%", "600 tokens", "Subiu 100%"],
        ["web", "40%", "400 tokens", "Caiu 50%"],
      ]),
    }).toEqual({ tab: "true", rows: [true, true] });
  });

  // axe target-size (#124 prints): a project's name is a button, at least 24 px tall.
  test("a project's button is a target of at least 24 px", () => {
    const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    expect(/@utility leader-link \{[^}]*min-height: 1\.5rem/.test(css)).toBe(true);
  });

  test("a host whose week of costs fails did not answer, even though its usage came (#363)", async () => {
    setup({ refuse: ["2026-10-04|2026-10-10"] });
    await settleMaybe(() => screen.queryByText("Some hosts did not answer: host1.") !== null);
    expect(screen.queryByText("Some hosts did not answer: host1.") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a refresh whose costs fail keeps the shares read before", async () => {
    const failing = { now: false };
    const { ranges } = setup({ failing, refreshMs: 150 });
    await loaded("Where the tokens went");
    const before = rows("Where the tokens went", [
      ["app", "60%"],
      ["web", "40%"],
    ]);
    failing.now = true;
    const asked = ranges.length;
    await settle(() => ranges.length >= asked + 6);
    expect({
      before,
      after: rows("Where the tokens went", [
        ["app", "60%"],
        ["web", "40%"],
      ]),
    }).toEqual({
      before: [true, true],
      after: [true, true],
    });
  });
});
