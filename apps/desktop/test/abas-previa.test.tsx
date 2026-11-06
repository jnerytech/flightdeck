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

async function mount() {
  const mem = memoryPlatform(false, "en");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {});
  const item = (name: RegExp) => screen.queryByRole("button", { name }) as HTMLElement;
  /** The tabs of the active host's own set, by screen. */
  const names = () => store.tabs.tabs.map((tab) => tab.router.current.name);
  /** A single click on a screen of the host: its preview tab (shared screens are pinned instead). */
  const preview = (name: "history" | "projects" | "workflows") =>
    act(async () => void store.hostTabs.openPreview({ name, host: "ha" }));
  return { store, item, names, preview };
}

describe("abas-previa", () => {
  test("a single click on a host's screen replaces the preview tab; a used tab is kept", async () => {
    const { store, names, preview } = await mount();
    await preview("history");
    await preview("projects");
    expect(names()).toEqual(["projects"]);
    // Working in the screen turns the preview into a regular tab.
    const main = screen.queryByLabelText("Area 1") as HTMLElement;
    await act(async () => void fireEvent.pointerDown(main));
    expect(store.tabs.active.preview).toBe(false);
    await preview("workflows");
    expect(names()).toEqual(["projects", "workflows"]);
    expect(store.tabs.active.preview).toBe(true);
    store.dispose();
  });

  test("a double click on the tab keeps it", async () => {
    const { store, names, preview } = await mount();
    await preview("history");
    const first = screen.queryByRole("tab", { name: /alfa/ }) as HTMLElement;
    expect(first.dataset.preview).toBe("true");
    await act(async () => void fireEvent.doubleClick(first));
    expect(store.tabs.active.preview).toBe(false);
    await preview("projects");
    expect(names()).toEqual(["history", "projects"]);
    const tab = screen.queryByRole("tab", { name: /Projects/ }) as HTMLElement;
    expect(tab.dataset.preview).toBe("true");
    await act(async () => void fireEvent.doubleClick(tab));
    expect(tab.dataset.preview).toBe("false");
    store.dispose();
  });

  test("a single click on a shared screen gives it its pinned tab, never a preview", async () => {
    const { store, item } = await mount();
    await act(async () => void fireEvent.click(item(/^Vault/)));
    expect(store.hostTabs.shared.tabs.map((tab) => [tab.router.current.name, tab.preview])).toEqual(
      [
        ["home", false],
        ["vault", false],
      ],
    );
    expect(store.hostTabs.shared.tabs.every((tab) => tab.pinned)).toBe(true);
    store.dispose();
  });

  test("the preview tab is in italics and says so to a screen reader", async () => {
    const { store, preview } = await mount();
    await preview("history");
    const tab = screen.queryByRole("tab", { name: /alfa/ }) as HTMLElement;
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
