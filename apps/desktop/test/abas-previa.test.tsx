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

async function mount() {
  const store = new AppStore(memoryPlatform(false, "en").platform);
  render(<App store={store} />);
  await act(async () => {});
  const item = (name: RegExp) => screen.queryByRole("button", { name }) as HTMLElement;
  const names = () => store.tabs.tabs.map((tab) => tab.router.current.name);
  return { store, item, names };
}

describe("abas-previa", () => {
  test("a single click on a sidebar item replaces the preview tab; a used tab is kept", async () => {
    const { store, item, names } = await mount();
    await act(async () => void fireEvent.click(item(/^Vault/)));
    await act(async () => void fireEvent.click(item(/^Settings/)));
    expect(names()).toEqual(["settings"]);
    // Working in the screen turns the preview into a regular tab.
    const main = screen.queryByLabelText("Area 1") as HTMLElement;
    await act(async () => void fireEvent.pointerDown(main));
    expect(store.tabs.active.preview).toBe(false);
    await act(async () => void fireEvent.click(item(/^Vault/)));
    expect(names()).toEqual(["settings", "vault"]);
    expect(store.tabs.active.preview).toBe(true);
    store.dispose();
  });

  test("a double click on a sidebar item, or on the tab, keeps the tab", async () => {
    const { store, item, names } = await mount();
    await act(async () => void fireEvent.click(item(/^Vault/)));
    await act(async () => void fireEvent.doubleClick(item(/^Vault/)));
    expect(store.tabs.active.preview).toBe(false);
    await act(async () => void fireEvent.click(item(/^Settings/)));
    expect(names()).toEqual(["vault", "settings"]);
    const tab = screen.queryByRole("tab", { name: /Settings/ }) as HTMLElement;
    expect(tab.dataset.preview).toBe("true");
    await act(async () => void fireEvent.doubleClick(tab));
    expect(tab.dataset.preview).toBe("false");
    store.dispose();
  });

  test("the preview tab is in italics and says so to a screen reader", async () => {
    const { store, item } = await mount();
    await act(async () => void fireEvent.click(item(/^Vault/)));
    const tab = screen.queryByRole("tab", { name: /Vault/ }) as HTMLElement;
    expect(tab.querySelector(".italic")).not.toBeNull();
    expect(tab.getAttribute("aria-description")).toBe("preview");
    store.dispose();
  });

  test("ctrl+click opens a regular tab", async () => {
    const { store, item, names } = await mount();
    await act(async () => void fireEvent.click(item(/^Vault/), { ctrlKey: true }));
    expect(names()).toEqual(["home", "vault"]);
    expect(store.tabs.active.preview).toBe(false);
    store.dispose();
  });
});
