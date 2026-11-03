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

describe("abas-vazio-ui: with no tab the area shows a calm start screen", () => {
  test("closing the last tab hides the strip and shows where to begin; a click opens a tab", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(1);
    await act(async () => {
      store.closeTab(store.tabs, store.tabs.activeId);
    });
    expect(store.tabs.tabs).toHaveLength(0);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tablist")).toBeNull();
    const start = screen.queryByRole("region", { name: "Nada aberto" }) as HTMLElement;
    expect(start).not.toBeNull();
    expect(within(start).queryByText("Ctrl+K")).not.toBeNull();
    expect(within(start).queryByRole("button", { name: "Sessões" })).not.toBeNull();
    expect(within(start).queryByRole("button", { name: "Precisa de você" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(start).queryByRole("button", { name: "Sessões" }) as HTMLElement);
    });
    expect(store.tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["hub"]);
    expect(screen.queryByRole("region", { name: "Nada aberto" })).toBeNull();
  });

  test("a click in the sidebar opens a tab from the empty window", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.closeTab(store.tabs, store.tabs.activeId);
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Cofre" }) as HTMLElement);
    });
    expect(store.tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["vault"]);
  });
});
