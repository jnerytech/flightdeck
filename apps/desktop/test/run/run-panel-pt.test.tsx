import { afterEach, describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { RunPanel } = await import("../../src/features/runenv/run-panel.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);
const settle = waiter(3000);

async function ptStore() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  await store.i18n.setLang("pt-BR");
  return store;
}

// #3637: the run buttons and the start dialog's input name were English words in the pt-BR app.
describe("pt-BR: the run panel and the card start dialog read in Portuguese (#3637)", () => {
  test("the run panel's button is not the English word Run", async () => {
    const store = await ptStore();
    store.runEnv.config = (async () => ({
      exists: true,
      hash: "h",
      trusted: true,
      errors: [],
      config: { exclusive: false, setup: null, run: [], ports: [] },
    })) as unknown as typeof store.runEnv.config;
    render(
      <TContext.Provider value={store.i18n.t}>
        <RunPanel store={store} hostId="h" card={{ id: "c1", projectId: "p" } as Card} />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByText(store.i18n.t("runEnv.status.idle")) !== null);
    const english = screen.queryByRole("button", { name: "Run" }) !== null;
    const own = screen.queryByRole("button", { name: store.i18n.t("runEnv.run") }) !== null;
    expect({ english, own }).toEqual({ english: false, own: true });
  });

  test("Stop and the start dialog's input name are not English words", async () => {
    const t = (await ptStore()).i18n.t;
    expect({
      stop: t("runEnv.stop") === "Stop",
      input: t("cardUi.input", { name: "issue" }).startsWith("Input"),
    }).toEqual({ stop: false, input: false });
  });
});
