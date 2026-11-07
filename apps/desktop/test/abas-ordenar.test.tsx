import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const names = () =>
  screen.queryAllByRole("tab").map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
const tab = (name: string) =>
  screen.queryAllByRole("tab").find((el) => (el.textContent ?? "").includes(name)) as HTMLElement;

/**
 * Three tabs of one host, "alfa", in its own set: its history, Projects and automatic approvals.
 * The shared Sessões stays pinned at the left of the row and is not part of what moves.
 */
async function three(platform = memoryPlatform(false, "pt-BR")) {
  seedDemoHosts(platform.win.localStorage, platform.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(platform.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {
    store.hostTabs.open({ name: "history", host: "ha" });
    store.hostTabs.open({ name: "projects", host: "ha" });
    store.hostTabs.open({ name: "auto-approvals", host: "ha" });
  });
  return { store, platform };
}
/** The host's tabs: every tab of the row but the shared one. */
const hostTabs = () => screen.queryAllByRole("tab").slice(1);
const press = async (el: HTMLElement, key: string, init: Record<string, boolean> = {}) => {
  await act(async () => {
    fireEvent.keyDown(el, { key, ctrlKey: true, shiftKey: true, ...init });
  });
};

describe("abas-ordenar: reordenar pelo teclado", () => {
  test("Ctrl+Shift+Seta on a focused tab moves that tab, not only the active one, and the focus stays on it", async () => {
    await three();
    const middle = tab("Projetos");
    middle.focus();
    await press(middle, "ArrowRight");
    expect(names()).toEqual(["Sessões", "alfa", "Aprovações automáticas", "Projetos"]);
    expect(document.activeElement).toBe(tab("Projetos"));
    await press(tab("Projetos"), "ArrowLeft");
    await press(tab("Projetos"), "ArrowLeft");
    expect(names()).toEqual(["Sessões", "Projetos", "alfa", "Aprovações automáticas"]);
    expect(document.activeElement).toBe(tab("Projetos"));
  });

  test("at the end of the group the key does nothing; without Ctrl and Shift it is not a move", async () => {
    await three();
    // The first tab of the host does not cross into the shared tabs on its left.
    await press(tab("alfa"), "ArrowLeft");
    await press(tab("Aprovações automáticas"), "ArrowRight");
    await press(tab("alfa"), "ArrowRight", { ctrlKey: false });
    await press(tab("alfa"), "ArrowRight", { shiftKey: false });
    expect(names()).toEqual(["Sessões", "alfa", "Projetos", "Aprovações automáticas"]);
  });

  test("a pinned tab does not cross the unpinned ones", async () => {
    const { store } = await three();
    await act(async () => store.tabs.pin(store.tabs.tabs[0]?.id ?? "", true));
    await press(tab("Projetos"), "ArrowLeft");
    expect(names()).toEqual(["Sessões", "alfa", "Projetos", "Aprovações automáticas"]);
  });

  test("a move is announced to a screen reader with the new place", async () => {
    await three();
    expect(screen.queryByRole("status", { name: "Posição das abas" })?.textContent ?? "").toBe("");
    await press(tab("Aprovações automáticas"), "ArrowLeft");
    expect(screen.queryByRole("status", { name: "Posição das abas" })?.textContent).toBe(
      "Aba Aprovações automáticas movida para a posição 2 de 3",
    );
  });

  test("the tab says how to move it", async () => {
    await three();
    expect(tab("Projetos").getAttribute("aria-keyshortcuts")).toContain("Control+Shift+ArrowLeft");
  });
});

describe("abas-ordenar: arrastar e guardar", () => {
  test("while a tab is dragged over another, the drop place is marked, and the mark goes at the drop", async () => {
    await three();
    const [first, , last] = hostTabs();
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(last as HTMLElement);
    });
    expect(last?.parentElement?.getAttribute("data-drop")).toBe("after");
    await act(async () => {
      fireEvent.drop(last as HTMLElement);
    });
    expect(document.querySelector("[data-drop]")).toBeNull();
    expect(names()).toEqual(["Sessões", "Projetos", "Aprovações automáticas", "alfa"]);
  });

  test("a tab dragged leftwards marks the drop place before the tab it is over, and drops there", async () => {
    await three();
    const [first, , last] = hostTabs();
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
    expect(names()).toEqual(["Sessões", "Aprovações automáticas", "alfa", "Projetos"]);
  });

  test("a drag that ends elsewhere clears the mark", async () => {
    await three();
    const [first, second] = hostTabs();
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(second as HTMLElement);
    });
    expect(document.querySelector("[data-drop]")).not.toBeNull();
    await act(async () => {
      fireEvent.dragEnd(first as HTMLElement);
    });
    expect(document.querySelector("[data-drop]")).toBeNull();
    expect(names()).toEqual(["Sessões", "alfa", "Projetos", "Aprovações automáticas"]);
  });

  test("the order is kept: a new window opens the tabs as they were left", async () => {
    const { platform } = await three();
    await press(tab("Aprovações automáticas"), "ArrowLeft");
    await press(tab("Aprovações automáticas"), "ArrowLeft");
    expect(names()).toEqual(["Sessões", "Aprovações automáticas", "alfa", "Projetos"]);
    cleanup();
    render(<App store={new AppStore(platform.platform, { baseDelayMs: 600_000 })} />);
    // The host's name arrives once the hosts are loaded; the order is what was kept.
    await waitFor(() =>
      expect(names().join("|")).toBe("Sessões|Aprovações automáticas|alfa|Projetos"),
    );
  });
});
