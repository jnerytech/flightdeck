import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

async function mount() {
  const mem = memoryPlatform(false, "pt-BR");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
    { id: "hb", name: "beta", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {
    store.hostTabs.open({ name: "host", host: "ha" });
    store.hostTabs.open({ name: "history", host: "ha" });
    store.hostTabs.open({ name: "projects", host: "ha" });
  });
  return store;
}

/** The window's tab row. */
const tabs = () => {
  const row = screen.queryByRole("tablist", { name: "Abas" });
  return row ? within(row).queryAllByRole("tab") : [];
};
/** What a tab shows: its title, without the host. */
const shown = () => tabs().map((tab) => tab.textContent ?? "");
/** What a screen reader says of a tab. */
const named = () => tabs().map((tab) => tab.getAttribute("aria-label") ?? tab.textContent ?? "");
const announced = () => screen.queryByRole("status", { name: "Posição das abas" })?.textContent;

// Issue #644: the row belongs to a host, so its tabs do not repeat the host's name; a screen reader
// still hears which host a tab is on.
describe("tab-titles: a host's tabs are titled by what they show, and named with the host", () => {
  test("the Overview and History tabs show their section, not the host's name", async () => {
    await mount();
    // The shared tab is only its icon.
    expect(shown()).toEqual(["", "Visão geral", "Histórico", "Projetos"]);
  });

  test("each host tab is named with its host for a screen reader; the shared tab is not", async () => {
    await mount();
    expect(named()).toEqual([
      "Sessões",
      "Visão geral, host alfa",
      "Histórico, host alfa",
      "Projetos, host alfa",
    ]);
  });

  test("picking another host says which host and how many tabs it has, politely", async () => {
    const store = await mount();
    await act(async () => {
      store.hostTabs.open({ name: "history", host: "hb" });
    });
    expect(announced()).toBe("beta: 1 aba");
    await act(async () => {
      store.pickHost("ha");
    });
    expect(announced()).toBe("alfa: 3 abas");
    expect(
      screen.queryByRole("status", { name: "Posição das abas" })?.getAttribute("aria-live"),
    ).toBe("polite");
  });
});
