import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CostsSummary } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySummary } = await import("../src/lib/client-costs.ts");
const { HomePage } = await import("../src/ui/HomePage.tsx");
const { CostsPage } = await import("../src/ui/CostsPage.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const DOCS_ALFA = "host:alfa:/work/docs-site";
const DOCS_BETA = "host:beta:/srv/docs-site";
/** Six more projects, so that alfa's docs-site is first and beta's is past the five Home lists. */
const OTHERS = ["a", "b", "c", "d", "e"].map((name) => `host:alfa:/work/${name}`);

/** What a host's costs say for any range: alfa's docs-site leads, beta's trails the whole list. */
function summary(host: string, from: string, to: string): CostsSummary {
  const base = emptySummary(from, to);
  const rows =
    host === "alfa"
      ? [
          { projectKey: DOCS_ALFA, tokens: 900, costUsd: 9 },
          ...OTHERS.map((projectKey, i) => ({ projectKey, tokens: 500 - i * 10, costUsd: 1 })),
        ]
      : [{ projectKey: DOCS_BETA, tokens: 5, costUsd: 0.01 }];
  return {
    ...base,
    byProject: rows,
    byDay: [{ day: from, projectKey: rows[0]?.projectKey ?? "", costUsd: 1, tokens: 1 }],
    totals: { ...base.totals, costUsd: 10 },
  } as CostsSummary;
}

function world(language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, {
    baseDelayMs: 600_000,
    day: () => "2026-10-10",
  });
  store.i18n.start();
  const hostOf = (id: string) => (id === "ha" ? "alfa" : "beta");
  store.hostRequest = (async (hostId: string, command: string, payload: unknown) => {
    if (command === "usage.summary") return { ok: true, data: { days: 7, rows: [] } };
    const { from, to } = payload as { from: string; to: string };
    return { ok: true, data: summary(hostOf(hostId), from, to) };
  }) as never;
  store.hostCommand = (async (hostId: string, command: string, payload: unknown) => {
    if (command !== "costs.summary") return null;
    const { from, to } = payload as { from: string; to: string };
    return summary(hostOf(hostId), from, to);
  }) as never;
  const hosts = ["ha", "hb"].map((id) => ({
    id,
    name: hostOf(id),
    status: "online",
    hostInfo: { daemonVersion: "x", features: ["costs"] },
    sessions: [],
  }));
  const internals = store as unknown as { update(p: object): void };
  internals.update({ hosts, hostsLoaded: true });
  return { store, hosts };
}

// Issue #881: one project, one label, whatever the screen and whatever Home lists.
describe("project-label-ui: Home and Costs name a project the same way", () => {
  test("Home names a project that shares its name with another host's, though the other is past its list", async () => {
    const { store, hosts } = world();
    const state = {
      ...store.getState(),
      hosts,
      hostsLoaded: true,
      budgets: {},
    } as never as ReturnType<typeof store.getState>;
    render(
      <TContext.Provider value={store.i18n.t}>
        <HomePage store={store} state={state} go={() => {}} />
      </TContext.Provider>,
    );
    await settle(() => screen.queryAllByRole("button", { name: /^Open the costs of / }).length > 0);
    const names = screen
      .queryAllByRole("button", { name: /^Open the costs of / })
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toContain("Open the costs of docs-site · alfa");
    expect(names).not.toContain("Open the costs of docs-site");
  });

  test("Costs on one host still names its project with the host, because Home saw the other", async () => {
    const { store } = world();
    // What Home read a moment ago: both hosts' projects.
    store.projectKeys.note([DOCS_ALFA, DOCS_BETA]);
    render(
      <TContext.Provider value={store.i18n.t}>
        <CostsPage store={store} onOpenSession={() => {}} host="ha" period="7d" />
      </TContext.Provider>,
    );
    const field = () => screen.queryByLabelText("Project") as HTMLSelectElement | null;
    await settle(() => (field()?.options.length ?? 0) > 1);
    const options = [...(field()?.options ?? [])].map((option) => option.text);
    expect(options).toContain("docs-site · alfa");
    expect(options).not.toContain("docs-site");
  });
});
