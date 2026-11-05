import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TabSwitcherHost } = await import("../src/components/tabs/tab-switcher.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);

/** Tabs Sessions, Costs, Settings opened in that order (Settings active), the switcher mounted. */
function setup(lang: "en" | "pt-BR" = "en", order?: string) {
  const mem = memoryPlatform(false, lang);
  if (order) mem.platform.storage.setItem("flightdeck.tabOrder", order);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.tabs.open({ name: "costs" });
  store.tabs.open({ name: "settings" });
  render(<TabSwitcherHost store={store} />);
  return store;
}

const press = async (init: KeyboardEventInit & { key: string }, type = "keydown") => {
  const event = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    window.dispatchEvent(event);
  });
  return event;
};
const ctrlTab = (shiftKey = false) => press({ key: "Tab", ctrlKey: true, shiftKey });
const releaseCtrl = () => press({ key: "Control" }, "keyup");
const active = (store: InstanceType<typeof AppStore>) => store.tabs.active.router.current.name;
const options = () => within(screen.getByRole("listbox")).getAllByRole("option");
const selected = () => options().find((o) => o.getAttribute("aria-selected") === "true");

describe("tab-mru-ui: hold Ctrl and press Tab to cycle the recent tabs (issue #148)", () => {
  test("the overlay is a named listbox of the tabs in recency order, the previous one selected", async () => {
    setup();
    expect(screen.queryByRole("listbox")).toBeNull();
    const event = await ctrlTab();
    // The key is consumed: the page never sees it.
    expect(event.defaultPrevented).toBe(true);
    const list = screen.getByRole("listbox", { name: "Switch tab" });
    expect(list).toBeTruthy();
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Settings"),
      expect.stringContaining("Costs"),
      expect.stringContaining("Sessions"),
    ]);
    expect(selected()?.textContent).toContain("Costs");
    expect(options().filter((o) => o.getAttribute("aria-selected") === "false")).toHaveLength(2);
    // Each row has its icon; the overlay is a titled panel.
    for (const row of options()) expect(row.querySelector("svg")).not.toBeNull();
    expect(
      screen.getByText("Switch tab", { selector: "[data-slot='switcher-title']" }),
    ).toBeTruthy();
  });

  test("more Tab presses go down the list, Shift goes up, and releasing Ctrl activates the pick", async () => {
    const store = setup();
    await ctrlTab();
    await ctrlTab();
    expect(selected()?.textContent).toContain("Sessions");
    await ctrlTab(true);
    expect(selected()?.textContent).toContain("Costs");
    await ctrlTab(true);
    expect(selected()?.textContent).toContain("Settings");
    await ctrlTab();
    await ctrlTab();
    expect(selected()?.textContent).toContain("Sessions");
    await releaseCtrl();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(active(store)).toBe("hub");
  });

  test("Ctrl+Shift+Tab opens on the least recent tab", async () => {
    const store = setup();
    await ctrlTab(true);
    expect(selected()?.textContent).toContain("Sessions");
    await releaseCtrl();
    expect(active(store)).toBe("hub");
  });

  test("a tap goes to the previous tab and a second tap comes back", async () => {
    const store = setup();
    await ctrlTab();
    await releaseCtrl();
    expect(active(store)).toBe("costs");
    await ctrlTab();
    await releaseCtrl();
    expect(active(store)).toBe("settings");
  });

  test("Esc and a window blur cancel: the active tab stays and the overlay goes", async () => {
    const store = setup();
    await ctrlTab();
    const esc = await press({ key: "Escape" });
    expect(esc.defaultPrevented).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(active(store)).toBe("settings");
    // After a cancel the release of Ctrl does nothing.
    await releaseCtrl();
    expect(active(store)).toBe("settings");
    await ctrlTab();
    await act(async () => {
      window.dispatchEvent(new window.Event("blur"));
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    await releaseCtrl();
    expect(active(store)).toBe("settings");
  });

  test("the keys are consumed: no other listener sees the Tab, and other keys are left alone", async () => {
    setup();
    const seen: string[] = [];
    const spy = (e: Event) => void seen.push((e as KeyboardEvent).key);
    window.addEventListener("keydown", spy);
    await ctrlTab();
    await press({ key: "a" });
    window.removeEventListener("keydown", spy);
    expect(seen).toEqual(["a"]);
    // A plain Tab or Ctrl+another key never opens it.
    await releaseCtrl();
    await press({ key: "Tab" });
    await press({ key: "k", ctrlKey: true });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("with one tab there is nothing to switch to", async () => {
    const mem = memoryPlatform(false, "en");
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    render(<TabSwitcherHost store={store} />);
    const event = await ctrlTab();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  test("with the Tab order setting the switcher stays out of the way (today's behaviour)", async () => {
    const store = setup("en", "sequential");
    const event = await ctrlTab();
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(active(store)).toBe("settings");
  });

  test("it reads in Portuguese too, and the panel fits a narrow window", async () => {
    setup("pt-BR");
    await ctrlTab();
    expect(screen.getByRole("listbox", { name: "Trocar de aba" })).toBeTruthy();
    const panel = screen.getByRole("listbox").closest("[data-slot='switcher-panel']");
    expect(panel?.className).toContain("w-[min(22.5rem,calc(100vw-3rem))]");
    expect(panel?.className).toContain("max-h-[min(18rem,60vh)]");
  });

  test("a live region says where the pick is, for a screen reader", async () => {
    setup();
    await ctrlTab();
    expect(screen.getByRole("status").textContent).toBe("Costs, 2 of 3");
  });
});
