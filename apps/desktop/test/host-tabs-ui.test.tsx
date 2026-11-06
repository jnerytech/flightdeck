import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Two hosts, "alfa" and "beta", and the window on alfa's History. */
async function mount() {
  const mem = memoryPlatform(false, "pt-BR");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
    { id: "hb", name: "beta", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {
    store.hostTabs.open({ name: "history", host: "ha" });
    store.hostTabs.open({ name: "projects", host: "ha" });
  });
  return store;
}

/** The window's tab row: a host's Overview page has tabs of its own, which are not part of it. */
const tabs = () => {
  const row = screen.queryByRole("tablist", { name: "Abas" });
  return row ? within(row).queryAllByRole("tab") : [];
};
const names = () => tabs().map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
const selected = () =>
  tabs()
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
const switcher = () => document.querySelector<HTMLElement>(".top-bar-host");

describe("host-tabs-ui: the tab row follows the host (issue #644)", () => {
  test("the shared tabs sit first, then the active host's own", async () => {
    const store = await mount();
    expect(names()).toEqual(["Sessões", "alfa", "Projetos"]);
    expect(selected()).toEqual(["Projetos"]);
    // The shared tab has no ×: it belongs to no host.
    expect(screen.queryByLabelText("Fechar aba Sessões")).toBeNull();
    expect(screen.queryByLabelText("Fechar aba Projetos")).not.toBeNull();
    expect(store.activeHostId()).toBe("ha");
  });

  test("a shared tab becomes the selected one, shows its screen, and a host tab brings the host back", async () => {
    const store = await mount();
    await act(async () => {
      fireEvent.click(tabs()[0] as HTMLElement);
    });
    expect(selected()).toEqual(["Sessões"]);
    expect(store.hostTabs.onShared).toBe(true);
    // The host's tabs stay in the row, none of them selected, and the switcher keeps the last host.
    expect(names()).toEqual(["Sessões", "alfa", "Projetos"]);
    expect(store.activeHostId()).toBe("ha");
    await act(async () => {
      fireEvent.click(tabs()[1] as HTMLElement);
    });
    expect(selected()).toEqual(["alfa"]);
    expect(store.hostTabs.onShared).toBe(false);
  });

  test("a screen of another host swaps the row to that host's tabs, and the switcher follows", async () => {
    const store = await mount();
    await act(async () => {
      store.router.push({ name: "history", host: "hb" });
    });
    expect(store.activeHostId()).toBe("hb");
    expect(names()).toEqual(["Sessões", "beta"]);
    expect(switcher()?.getAttribute("aria-label") ?? "").toContain("beta");
    // alfa kept its own tabs.
    await act(async () => {
      store.pickHost("ha");
    });
    expect(names()).toEqual(["Sessões", "alfa", "Projetos"]);
    expect(selected()).toEqual(["Projetos"]);
  });

  test("picking a host in the switcher opens its set, and a host with no tab opens its Overview", async () => {
    const store = await mount();
    const trigger = switcher() as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
    });
    const beta = screen
      .queryAllByRole("menuitemradio")
      .find((item) => /beta/.test(item.textContent ?? ""));
    expect(beta === undefined).toBe(false);
    await act(async () => {
      if (beta) fireEvent.click(beta);
    });
    expect(store.activeHostId()).toBe("hb");
    expect(store.router.current).toEqual({ name: "host", host: "hb" });
    expect(names()).toEqual(["Sessões", "beta"]);
  });

  test("a new tab is the active host's Overview, or Home with no host", async () => {
    const store = await mount();
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Nova aba" }) as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "host", host: "ha" });
    expect(store.newTabRoute()).toEqual({ name: "host", host: "ha" });
    await act(async () => {
      store.hostTabs.removeHost("ha");
      store.hostTabs.removeHost("hb");
    });
    expect(store.newTabRoute()).toEqual({ name: "home" });
  });
});
