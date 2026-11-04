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
const tab = (name: string) =>
  screen.queryAllByRole("tab").find((el) => (el.textContent ?? "").includes(name)) as HTMLElement;

async function three(platform = memoryPlatform(false, "pt-BR")) {
  const store = new AppStore(platform.platform);
  render(<App store={store} />);
  await act(async () => {
    store.tabs.open({ name: "needs-you" });
    store.tabs.open({ name: "settings" });
  });
  return { store, platform };
}
const press = async (el: HTMLElement, key: string, init: Record<string, boolean> = {}) => {
  await act(async () => {
    fireEvent.keyDown(el, { key, ctrlKey: true, shiftKey: true, ...init });
  });
};

describe("abas-ordenar: reordenar pelo teclado", () => {
  test("Ctrl+Shift+Seta on a focused tab moves that tab, not only the active one, and the focus stays on it", async () => {
    await three();
    const middle = tab("Precisa de você");
    middle.focus();
    await press(middle, "ArrowRight");
    expect(names()).toEqual(["Sessões", "Configurações", "Precisa de você"]);
    expect(document.activeElement).toBe(tab("Precisa de você"));
    await press(tab("Precisa de você"), "ArrowLeft");
    await press(tab("Precisa de você"), "ArrowLeft");
    expect(names()).toEqual(["Precisa de você", "Sessões", "Configurações"]);
    expect(document.activeElement).toBe(tab("Precisa de você"));
  });

  test("at the end of the group the key does nothing; without Ctrl and Shift it is not a move", async () => {
    await three();
    await press(tab("Sessões"), "ArrowLeft");
    await press(tab("Configurações"), "ArrowRight");
    await press(tab("Sessões"), "ArrowRight", { ctrlKey: false });
    await press(tab("Sessões"), "ArrowRight", { shiftKey: false });
    expect(names()).toEqual(["Sessões", "Precisa de você", "Configurações"]);
  });

  test("a pinned tab does not cross the unpinned ones", async () => {
    const { store } = await three();
    await act(async () => store.tabs.pin(store.tabs.tabs[0]?.id ?? "", true));
    await press(tab("Precisa de você"), "ArrowLeft");
    expect(names()).toEqual(["Sessões", "Precisa de você", "Configurações"]);
  });

  test("a move is announced to a screen reader with the new place", async () => {
    await three();
    expect(screen.queryByRole("status", { name: "Posição das abas" })?.textContent ?? "").toBe("");
    await press(tab("Configurações"), "ArrowLeft");
    expect(screen.queryByRole("status", { name: "Posição das abas" })?.textContent).toBe(
      "Aba Configurações movida para a posição 2 de 3",
    );
  });

  test("the tab says how to move it", async () => {
    await three();
    expect(tab("Precisa de você").getAttribute("aria-keyshortcuts")).toContain(
      "Control+Shift+ArrowLeft",
    );
  });
});

describe("abas-ordenar: arrastar e guardar", () => {
  test("while a tab is dragged over another, the drop place is marked, and the mark goes at the drop", async () => {
    await three();
    const [first, , last] = screen.queryAllByRole("tab");
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(last as HTMLElement);
    });
    expect(last?.parentElement?.getAttribute("data-drop")).toBe("after");
    await act(async () => {
      fireEvent.drop(last as HTMLElement);
    });
    expect(document.querySelector("[data-drop]")).toBeNull();
    expect(names()).toEqual(["Precisa de você", "Configurações", "Sessões"]);
  });

  test("a tab dragged leftwards marks the drop place before the tab it is over, and drops there", async () => {
    await three();
    const [first, , last] = screen.queryAllByRole("tab");
    await act(async () => {
      fireEvent.dragStart(last as HTMLElement);
      fireEvent.dragOver(first as HTMLElement);
    });
    const wrapper = first?.parentElement as HTMLElement;
    expect(wrapper.getAttribute("data-drop")).toBe("before");
    expect(wrapper.className).toContain("border-l-primary");
    expect(wrapper.className).not.toContain("border-r-primary");
    await act(async () => {
      fireEvent.drop(first as HTMLElement);
    });
    expect(names()).toEqual(["Configurações", "Sessões", "Precisa de você"]);
  });

  test("a drag that ends elsewhere clears the mark", async () => {
    await three();
    const [first, second] = screen.queryAllByRole("tab");
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(second as HTMLElement);
    });
    expect(document.querySelector("[data-drop]")).not.toBeNull();
    await act(async () => {
      fireEvent.dragEnd(first as HTMLElement);
    });
    expect(document.querySelector("[data-drop]")).toBeNull();
    expect(names()).toEqual(["Sessões", "Precisa de você", "Configurações"]);
  });

  test("the order is kept: a new window opens the tabs as they were left", async () => {
    const { platform } = await three();
    await press(tab("Configurações"), "ArrowLeft");
    await press(tab("Configurações"), "ArrowLeft");
    expect(names()).toEqual(["Configurações", "Sessões", "Precisa de você"]);
    cleanup();
    render(<App store={new AppStore(platform.platform)} />);
    expect(names()).toEqual(["Configurações", "Sessões", "Precisa de você"]);
  });
});
