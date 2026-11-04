import { afterEach, describe, test } from "bun:test";
import type { Project, RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { EMPTY_PERIOD } from "../src/lib/roi.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { RoiTable } = await import("../src/components/roi/roi-table.tsx");
const { RoiCard } = await import("../src/components/roi/roi-card.tsx");

afterEach(cleanup);
const settle = waiter(5000);

const SHOP: RoiPeriod = { ...EMPTY_PERIOD, costUsd: 12, cards: 3, prsMerged: 3, hours: 6 };
const RESULT: RoiSummaryResult = {
  from: "2026-10-01",
  to: "2026-10-14",
  previousFrom: "2026-09-17",
  previousTo: "2026-09-30",
  projects: [{ projectKey: "k-shop", name: "shop", current: SHOP, previous: EMPTY_PERIOD }],
};

/** A store whose hosts answer with one project; nothing re-renders the screens but the store. */
function answering() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  store.roiSummaries = async () => [{ hostId: "h1", result: RESULT }];
  return store;
}

describe("roi-reativo-isolado: the figures follow the rate the person types, whoever renders them", () => {
  test("the project table fills its value column when a rate is saved", async () => {
    const store = answering();
    render(
      <RoiTable
        store={store}
        hostIds={["h1"]}
        from="2026-10-01"
        to="2026-10-14"
        selection="all"
        projectName={() => "shop"}
      />,
    );
    await settle(() => screen.queryByRole("table", { name: ptBR.roiUi.tableTitle }) !== null);
    await act(async () => {
      store.roi.setDefaultRate(60);
    });
    await settle(() => screen.queryAllByText(/360[.,]00/).length > 0, 2000);
    store.dispose();
  });

  test("the card shows the value when a rate is saved elsewhere", async () => {
    const store = answering();
    const project = {
      id: "p1",
      path: "/work/shop",
      projectKey: "k-shop",
      defaultHours: null,
      roiSignals: { commits: false, issues: false },
    } as unknown as Project;
    render(<RoiCard store={store} hostId="h1" project={project} />);
    await settle(() => screen.queryByText(ptBR.roiUi.noRate) !== null);
    await act(async () => {
      store.roi.setDefaultRate(60);
    });
    await settle(() => screen.queryByText(ptBR.roiUi.noRate) === null, 2000);
    store.dispose();
  });
});
