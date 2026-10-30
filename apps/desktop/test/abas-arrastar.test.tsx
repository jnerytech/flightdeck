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

const names = () =>
  screen.queryAllByRole("tab").map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);

describe("abas: arrastar para reordenar", () => {
  test("dragging a tab onto another puts it there, within its group", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.open({ name: "settings" });
    });
    expect(names()).toEqual(["Sessões", "Precisa de você", "Configurações"]);
    const [first, , last] = screen.queryAllByRole("tab");
    expect(first?.getAttribute("draggable")).toBe("true");
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(last as HTMLElement);
      fireEvent.drop(last as HTMLElement);
    });
    expect(names()).toEqual(["Precisa de você", "Configurações", "Sessões"]);
  });

  test("a drop with nothing being dragged changes nothing", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    await act(async () => {
      fireEvent.drop(screen.queryAllByRole("tab")[0] as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Precisa de você"]);
  });
});
