import { afterEach, describe, expect, test } from "bun:test";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { RoiPeople } = await import("../src/components/roi/roi-people.tsx");

afterEach(cleanup);
const settle = waiter(5000);

describe("roi-pessoas-reativa: the people table follows the people the person keeps", () => {
  test("a person added after the table loaded shows up without waiting for the next refresh", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    // Count the answers that came back: once the first load has finished, nothing else re-renders
    // the table, which is what the test is about.
    const asked = store.roiSummaries.bind(store);
    let answered = 0;
    store.roiSummaries = async (...args) => {
      const all = await asked(...args);
      answered += 1;
      return all;
    };
    render(<RoiPeople store={store} />);
    await settle(() => screen.queryByText(ptBR.roiUi.people.empty) !== null && answered > 0);
    await act(async () => {});
    await act(async () => {
      store.roi.addPerson({ name: "Ana", hostIds: ["h1"] });
    });
    await settle(
      () => screen.queryByRole("table", { name: ptBR.roiUi.people.title }) !== null,
      3000,
    );
    expect(screen.queryByRole("table", { name: ptBR.roiUi.people.title })).not.toBeNull();
    store.dispose();
  });
});
