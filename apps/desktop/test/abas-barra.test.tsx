import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  render(<App store={store} />);
  return store;
}

const tabs = () => screen.queryAllByRole("tab");
const names = () => tabs().map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
};
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) =>
  act(async () => {
    fireEvent.keyDown(window, {
      key: k,
      ctrlKey: mods.ctrl ?? true,
      shiftKey: mods.shift ?? false,
    });
  });

describe("abas: a barra de abas", () => {
  test("a tab bar lists the tabs by title, the active one selected; a click switches", async () => {
    const store = setup();
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    expect(screen.queryByRole("tablist", { name: "Abas" })).not.toBeNull();
    expect(names()).toEqual(["Sessões", "Precisa de você"]);
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    await act(async () => {
      fireEvent.click(tabs()[0] as HTMLElement);
    });
    expect(store.tabs.activeId).toBe(store.tabs.tabs[0]?.id as string);
  });

  test("the title follows the tab's own navigation", async () => {
    const store = setup();
    await act(async () => {
      store.router.push({ name: "needs-you" });
    });
    expect(names()).toEqual(["Precisa de você"]);
  });

  test("the active tab's buttons pin it (icon only, on the left) and close it; the middle button closes any tab", async () => {
    const store = setup();
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    await press("Fixar aba Precisa de você");
    expect(names()).toEqual(["Precisa de você", "Sessões"]);
    expect(screen.queryByRole("button", { name: "Desafixar aba Precisa de você" })).not.toBeNull();
    expect(screen.queryByText("Precisa de você", { selector: "[role=tab] span" })).toBeNull();
    await act(async () => {
      fireEvent.click(tabs()[1] as HTMLElement);
    });
    // The buttons are the active tab's: Sessões now.
    expect(screen.queryByRole("button", { name: "Desafixar aba Precisa de você" })).toBeNull();
    await press("Fechar aba Sessões");
    expect(names()).toEqual(["Precisa de você"]);
    await act(async () => {
      store.tabs.open({ name: "costs" });
      store.tabs.activate(store.tabs.tabs[0]?.id as string);
    });
    await act(async () => {
      fireEvent(
        tabs()[1] as HTMLElement,
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    });
    expect(names()).toEqual(["Precisa de você"]);
  });

  test("Ctrl+T opens a new tab on the palette; Ctrl+W closes the tab; Ctrl+Shift+T brings it back", async () => {
    const store = setup();
    await key("t");
    expect(tabs()).toHaveLength(2);
    expect(store.getState().searchOpen).toBe(true);
    await key("w");
    expect(tabs()).toHaveLength(1);
    await key("T", { shift: true });
    expect(tabs()).toHaveLength(2);
  });

  test("Ctrl+Tab and Ctrl+Shift+Tab walk the tabs, Ctrl+N goes to the Nth", async () => {
    const store = setup();
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.open({ name: "costs" });
    });
    const index = () => store.tabs.tabs.findIndex((tab) => tab.id === store.tabs.activeId);
    await key("Tab");
    expect(index()).toBe(0);
    await key("Tab", { shift: true });
    expect(index()).toBe(2);
    await key("2");
    expect(index()).toBe(1);
  });

  test("Ctrl+Shift+PageDown and PageUp move the tab", async () => {
    const store = setup();
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    await key("PageUp", { shift: true });
    expect(names()).toEqual(["Precisa de você", "Sessões"]);
    await key("PageDown", { shift: true });
    expect(names()).toEqual(["Sessões", "Precisa de você"]);
  });

  test("a Ctrl+click or a middle click on an item opens it in a new tab", async () => {
    const store = setup();
    const item = () => {
      const found = screen.queryByRole("button", { name: "Precisa de você" });
      expect(found).not.toBeNull();
      return found as HTMLElement;
    };
    await act(async () => {
      fireEvent.click(item(), { ctrlKey: true });
    });
    expect(store.tabs.tabs).toHaveLength(2);
    expect(store.router.current).toEqual({ name: "needs-you" });
    await act(async () => {
      store.tabs.activate(store.tabs.tabs[0]?.id as string);
      fireEvent(item(), new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    });
    expect(store.tabs.tabs).toHaveLength(3);
  });

  test("a normal click changes the current tab only", async () => {
    const store = setup();
    await press("Precisa de você");
    expect(store.tabs.tabs).toHaveLength(1);
    expect(store.router.current).toEqual({ name: "needs-you" });
  });
});
