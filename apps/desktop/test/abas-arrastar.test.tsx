import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { tabMenu } from "./aba-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { tabName } from "./tab-names.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const menu = tabMenu({ act, fireEvent, screen } as never);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const names = () => screen.queryAllByRole("tab").map((tab) => tabName(tab));

/**
 * A store with one host, "alfa", and `count` of its tabs open: its history, Projects and automatic
 * approvals. The shared Sessões stays pinned at the left of the row and is not part of what moves.
 */
async function open(count: number) {
  const mem = memoryPlatform(false, "pt-BR");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {
    for (const name of ["history", "projects", "auto-approvals"].slice(0, count)) {
      store.hostTabs.open({ name, host: "ha" } as never);
    }
  });
  return store;
}

describe("abas: arrastar para reordenar", () => {
  test("dragging a tab onto another puts it there, within its group", async () => {
    await open(3);
    expect(names()).toEqual(["Sessões", "Histórico", "Projetos", "Aprovações automáticas"]);
    const [first, , last] = screen.queryAllByRole("tab").slice(1);
    expect(first?.getAttribute("draggable")).toBe("true");
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(last as HTMLElement);
      fireEvent.drop(last as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Projetos", "Aprovações automáticas", "Histórico"]);
  });

  test("a drop with nothing being dragged changes nothing", async () => {
    await open(1);
    await act(async () => {
      fireEvent.drop(screen.queryAllByRole("tab")[1] as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Histórico"]);
  });

  test("the buttons Mover para a esquerda e para a direita reordenam a aba ativa, desligados nas pontas do grupo", async () => {
    await open(3);
    const left = "Mover a aba Aprovações automáticas para a esquerda";
    const right = "Mover a aba Aprovações automáticas para a direita";
    const disabled = (name: string) => menu.item(name)?.getAttribute("aria-disabled") === "true";
    await menu.open("Aprovações automáticas");
    expect(disabled(left)).toBe(false);
    expect(disabled(right)).toBe(true);
    await act(async () => {
      fireEvent.click(menu.item(left) as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Histórico", "Aprovações automáticas", "Projetos"]);
    await menu.open("Aprovações automáticas");
    expect(disabled(right)).toBe(false);
    await act(async () => {
      fireEvent.click(menu.item(left) as HTMLElement);
    });
    // The first tab of the host: the shared tabs on its left are another group.
    expect(names()).toEqual(["Sessões", "Aprovações automáticas", "Histórico", "Projetos"]);
    await menu.open("Aprovações automáticas");
    expect(disabled(left)).toBe(true);
    await act(async () => {
      fireEvent.click(menu.item(right) as HTMLElement);
    });
    expect(names()).toEqual(["Sessões", "Histórico", "Aprovações automáticas", "Projetos"]);
    // The menu closes with the focus back on the tab's own button or the tab, never on the page.
    // The menu hands the focus back after it closes, a beat later on a slow runner: wait for it,
    // and fail with a short message (a failed `expect` on the element dumps the whole page).
    await waitFor(() => {
      if (document.activeElement === document.body) throw new Error("the focus is on the page");
    });
  });

  test("a pinned tab keeps its group: the unpinned tab next to it cannot go left past it", async () => {
    const store = await open(2);
    await act(async () => {
      store.tabs.pin(store.tabs.tabs[0]?.id ?? "", true);
    });
    expect(names()).toEqual(["Sessões", "Histórico", "Projetos"]);
    await menu.open("Projetos");
    expect(menu.item("Mover a aba Projetos para a esquerda")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
});
