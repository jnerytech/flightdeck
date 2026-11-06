import { afterEach, describe, expect, test } from "bun:test";
import type { Project, RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { EMPTY_PERIOD } from "../src/lib/roi.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { RoiTable } = await import("../src/components/roi/roi-table.tsx");
const { RoiCard } = await import("../src/components/roi/roi-card.tsx");
const { RoiSettingsPanel } = await import("../src/components/roi/roi-settings-panel.tsx");
const { RoiSettings } = await import("../src/lib/roi-settings.ts");

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
    expect(screen.queryAllByText(/360[.,]00/).length).toBeGreaterThan(0);
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
    expect(screen.queryByText(ptBR.roiUi.noRate)).toBeNull();
    store.dispose();
  });

  test("a card whose hosts answer nothing says no host answered", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    store.roiSummaries = async () => [];
    const project = {
      id: "p1",
      path: "/work/shop",
      projectKey: "k-shop",
      defaultHours: null,
      roiSignals: { commits: false, issues: false },
    } as unknown as Project;
    render(<RoiCard store={store} hostId="h1" project={project} />);
    await settle(() => screen.queryByText(ptBR.roiUi.noHost) !== null);
    expect(screen.queryByText(ptBR.roiUi.noHost)).not.toBeNull();
    store.dispose();
  });

  test("a save the storage refuses is told as a number problem, not thrown at the screen", async () => {
    const mem = memoryPlatform();
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<RoiSettingsPanel store={store} />);
    const failing = {
      ...mem.platform.storage,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    Object.assign(store, { roi: new RoiSettings({ storage: failing }) });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(ptBR.roiUi.settingsPanel.defaultRate), {
        target: { value: "40" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ptBR.roiUi.settingsPanel.saveRate }));
    });
    await settle(
      () => screen.queryByRole("alert")?.textContent === ptBR.roiUi.settingsPanel.error.number,
    );
    expect(screen.queryByRole("alert")?.textContent).toBe(ptBR.roiUi.settingsPanel.error.number);
    store.dispose();
  });
});
