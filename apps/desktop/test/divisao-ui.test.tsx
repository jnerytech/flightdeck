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

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) =>
  act(async () => {
    fireEvent.keyDown(window, {
      key: k,
      ctrlKey: mods.ctrl ?? true,
      shiftKey: mods.shift ?? false,
    });
  });
const bars = () => screen.queryAllByRole("tablist");
const divider = () => screen.queryByRole("separator", { name: "Redimensionar a divisão" });
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
};

describe("divisao: a tela dividida", () => {
  test("Ctrl+\\ splits the window in two areas, each with its tab bar and a divider; again it joins", async () => {
    setup();
    expect(bars()).toHaveLength(1);
    expect(divider()).toBeNull();
    await key("\\");
    expect(bars()).toHaveLength(2);
    expect(divider()).not.toBeNull();
    expect(screen.queryAllByRole("region", { name: /^Área [12]$/ })).toHaveLength(2);
    await key("\\");
    expect(bars()).toHaveLength(1);
    expect(divider()).toBeNull();
  });

  test("the buttons split, flip the direction and join, for where Ctrl+\\ is not enough", async () => {
    const store = setup();
    await press("Dividir a tela");
    expect(store.workspace.split).toBe("vertical");
    await press("Dividir na horizontal");
    expect(store.workspace.split).toBe("horizontal");
    expect(divider()?.getAttribute("aria-orientation")).toBe("horizontal");
    await press("Juntar as áreas");
    expect(store.workspace.split).toBeNull();
  });

  test("the divider moves with the arrows and the pointer, inside 20% to 80%", async () => {
    const store = setup();
    await key("\\");
    expect(divider()).not.toBeNull();
    const bar = divider() as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    await act(async () => {
      fireEvent.keyDown(bar, { key: "ArrowRight" });
    });
    expect(store.workspace.fraction).toBeGreaterThan(0.5);
    await act(async () => {
      for (let i = 0; i < 40; i++) fireEvent.keyDown(bar, { key: "ArrowRight" });
    });
    expect(store.workspace.fraction).toBe(0.8);
    await act(async () => {
      for (let i = 0; i < 80; i++) fireEvent.keyDown(bar, { key: "ArrowLeft" });
    });
    expect(store.workspace.fraction).toBe(0.2);
  });

  test("a click in an area focuses it, and what is opened goes to the focused area", async () => {
    const store = setup();
    await key("\\");
    expect(store.workspace.focus).toBe(1);
    const first = screen.queryAllByRole("region", { name: /^Área [12]$/ })[0] as HTMLElement;
    expect(first).toBeDefined();
    await act(async () => {
      if (first) fireEvent.pointerDown(first);
    });
    expect(store.workspace.focus).toBe(0);
    await press("Precisa de você");
    expect(store.workspace.areas[0]?.router.current).toEqual({ name: "needs-you" });
    expect(store.workspace.areas[1]?.router.current).toEqual({ name: "home" });
  });

  test("Mover para a outra área sends the tab across; the area left empty closes", async () => {
    const store = setup();
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    await press("Mover a aba Precisa de você para a outra área");
    expect(store.workspace.split).toBe("vertical");
    expect(store.workspace.areas[1]?.tabs).toHaveLength(1);
    expect(store.workspace.areas[1]?.router.current).toEqual({ name: "needs-you" });
    await press("Mover a aba Precisa de você para a outra área");
    expect(store.workspace.split).toBeNull();
    expect(bars()).toHaveLength(1);
  });
});
