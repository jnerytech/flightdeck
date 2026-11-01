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

  test("the buttons Mover para a esquerda e para a direita reordenam a aba ativa, desligados nas pontas do grupo", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.open({ name: "settings" });
    });
    const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement;
    const left = () => button("Mover a aba Configurações para a esquerda");
    const right = () => button("Mover a aba Configurações para a direita");
    expect(left().disabled).toBe(false);
    expect(right().disabled).toBe(true);
    await act(async () => {
      fireEvent.click(left());
    });
    expect(names()).toEqual(["Sessões", "Configurações", "Precisa de você"]);
    expect(right().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(left());
    });
    expect(names()).toEqual(["Configurações", "Sessões", "Precisa de você"]);
    expect(left().disabled).toBe(true);
    // The button that just went off was the focus: it moves to the tab, not to the page.
    const selected = screen
      .queryAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(document.activeElement).toBe(selected as HTMLElement);
    await act(async () => {
      fireEvent.click(right());
    });
    expect(names()).toEqual(["Sessões", "Configurações", "Precisa de você"]);
  });

  test("a pinned tab keeps its group: the unpinned tab next to it cannot go left past it", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.pin(store.tabs.tabs[0]?.id ?? "", true);
    });
    expect(names()).toEqual(["Sessões", "Precisa de você"]);
    const left = screen.queryByRole("button", {
      name: "Mover a aba Precisa de você para a esquerda",
    }) as HTMLButtonElement;
    expect(left.disabled).toBe(true);
  });
});
