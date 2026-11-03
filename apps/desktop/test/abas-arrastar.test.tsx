import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { tabMenu } from "./aba-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const menu = tabMenu({ act, fireEvent, screen } as never);
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
    const left = "Mover a aba Configurações para a esquerda";
    const right = "Mover a aba Configurações para a direita";
    const disabled = (name: string) => menu.item(name)?.getAttribute("aria-disabled") === "true";
    await menu.open("Configurações");
    expect(disabled(left)).toBe(false);
    expect(disabled(right)).toBe(true);
    await act(async () => {
      fireEvent.click(menu.item(left) as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Configurações", "Precisa de você"]);
    await menu.open("Configurações");
    expect(disabled(right)).toBe(false);
    await act(async () => {
      fireEvent.click(menu.item(left) as HTMLElement);
    });
    expect(names()).toEqual(["Configurações", "Sessões", "Precisa de você"]);
    await menu.open("Configurações");
    expect(disabled(left)).toBe(true);
    await act(async () => {
      fireEvent.click(menu.item(right) as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Configurações", "Precisa de você"]);
    // The menu closes with the focus back on the tab's own button or the tab, never on the page.
    expect(document.activeElement).not.toBe(document.body);
  });

  test("a pinned tab keeps its group: the unpinned tab next to it cannot go left past it", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.pin(store.tabs.tabs[0]?.id ?? "", true);
    });
    expect(names()).toEqual(["Sessões", "Precisa de você"]);
    await menu.open("Precisa de você");
    expect(
      menu.item("Mover a aba Precisa de você para a esquerda")?.getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
