import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { hostColorVar } from "../src/lib/host-color.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { tabName } from "./tab-names.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Two hosts: alfa with Overview and History, beta with History, and the window on beta. */
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
    store.hostTabs.open({ name: "history", host: "hb" });
  });
  return { store, mem };
}

const row = () => screen.queryByRole("tablist", { name: "Abas" }) as HTMLElement;
const tabs = () => within(row()).queryAllByRole("tab");
const names = () => tabs().map((tab) => tabName(tab));
const full = () => tabs().map((tab) => tab.getAttribute("aria-label") ?? tab.textContent ?? "");
const items = () => [...row().querySelectorAll<HTMLElement>(".tab-item")];

/** Opens the host switcher and flips its "all hosts" entry. */
async function toggleAll() {
  const trigger = document.querySelector<HTMLElement>(".top-bar-host") as HTMLElement;
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(trigger);
  });
  const entry = screen.queryByRole("menuitemcheckbox", { name: "Abas de todos os hosts" });
  expect(entry === null).toBe(false);
  await act(async () => {
    fireEvent.click(entry as HTMLElement);
  });
}

// Issue #644: an optional "All hosts" entry shows every tab, grouped by host.
describe("host-tabs-all-ui: the switcher's All hosts entry groups every host's tabs in the row", () => {
  test("by default the row is the current host's; the entry is offered, unchecked", async () => {
    await mount();
    expect(full()).toEqual(["Sessões", "Histórico, host beta"]);
    const trigger = document.querySelector<HTMLElement>(".top-bar-host") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(trigger);
    });
    const entry = screen.queryByRole("menuitemcheckbox", { name: "Abas de todos os hosts" });
    expect(entry?.getAttribute("aria-checked")).toBe("false");
  });

  test("checked, every host's tabs follow the shared one, in groups headed by the host's name", async () => {
    const { store } = await mount();
    await toggleAll();
    expect(store.tabScope.value).toBe("all");
    expect(full()).toEqual([
      "Sessões",
      "Visão geral, host alfa",
      "Histórico, host alfa",
      "Histórico, host beta",
    ]);
    const headers = [...row().querySelectorAll("[data-slot='tab-group']")];
    expect(headers.map((h) => h.textContent)).toEqual(["alfa", "beta"]);
    // A header is only for the eyes: each tab already says its host.
    expect(headers.every((h) => h.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  test("each tab carries its own host's color, and only the active tab is selected", async () => {
    await mount();
    await toggleAll();
    const colors = items().map((item) => item.style.getPropertyValue("--host-color"));
    expect(colors).toEqual(["", hostColorVar("ha"), hostColorVar("ha"), hostColorVar("hb")]);
    const selected = tabs().map((tab) => tab.getAttribute("aria-selected"));
    expect(selected).toEqual(["false", "false", "false", "true"]);
  });

  test("a tab of another host switches to that host, and the switcher follows", async () => {
    const { store } = await mount();
    await toggleAll();
    await act(async () => {
      fireEvent.click(tabs()[2] as HTMLElement);
    });
    expect(store.activeHostId()).toBe("ha");
    expect(store.router.current).toEqual({ name: "history", host: "ha" });
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(document.querySelector(".top-bar-host")?.getAttribute("aria-label")).toContain("alfa");
  });

  test("a tab of another host closes from the row, and the choice is kept for the next window", async () => {
    const { store, mem } = await mount();
    await toggleAll();
    await act(async () => {
      // The first of the two Histórico crosses is alfa's.
      fireEvent.click(screen.queryAllByLabelText("Fechar aba Histórico")[0] as HTMLElement);
    });
    expect(store.hostTabs.tabCount("ha")).toBe(1);
    expect(store.hostTabs.tabCount("hb")).toBe(1);
    expect(new AppStore(mem.platform, { baseDelayMs: 600_000 }).tabScope.value).toBe("all");
  });

  test("unchecked again, the row is the current host's", async () => {
    const { store } = await mount();
    await toggleAll();
    await toggleAll();
    expect(store.tabScope.value).toBe("host");
    expect(names()).toEqual(["Sessões", "Histórico"]);
    expect(row().querySelector("[data-slot='tab-group']") === null).toBe(true);
  });
});
