import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../../src/demo/boot.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Two tabs of one host, "alfa": its history, then Projects (the active one). */
async function twoTabs() {
  const mem = memoryPlatform(false, "pt-BR");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {
    store.hostTabs.open({ name: "history", host: "ha" });
    store.hostTabs.open({ name: "projects", host: "ha" });
  });
  return store;
}

const closeButton = (title: string) => {
  const found = screen.queryByLabelText(`Fechar aba ${title}`);
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
const tab = (title: string) => {
  const found = screen.queryByRole("tab", { name: `${title}, host alfa` });
  expect(found).not.toBeNull();
  return found as HTMLElement;
};

describe("abas: o × de cada aba", () => {
  test("every tab has its own close button, next to the tab and not inside it", async () => {
    await twoTabs();
    for (const title of ["Histórico", "Projetos"]) {
      const close = closeButton(title);
      expect(close.parentElement).toBe(tab(title).parentElement);
      expect(close.parentElement?.getAttribute("role")).toBe("presentation");
      expect(tab(title).querySelector("button")).toBeNull();
      // axe refuses a button among the tabs of a tablist: the mouse gets the ×, the keyboard and
      // the screen reader get Delete (announced on the tab).
      expect(close.getAttribute("aria-hidden")).toBe("true");
      expect(close.getAttribute("tabindex")).toBe("-1");
      expect(tab(title).getAttribute("aria-keyshortcuts")).toBe(
        "Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight",
      );
    }
  });

  test("closing a tab that is not the active one closes it and keeps the active tab", async () => {
    const store = await twoTabs();
    const active = store.tabs.activeId;
    await act(async () => {
      fireEvent.click(closeButton("Histórico"));
    });
    expect(store.tabs.tabs.map((t) => t.id)).toEqual([active]);
    expect(store.tabs.activeId).toBe(active);
  });

  test("a pinned tab has no close button", async () => {
    const store = await twoTabs();
    await act(async () => {
      store.tabs.pin(store.tabs.activeId, true);
    });
    expect(screen.queryByLabelText("Fechar aba Projetos")).toBeNull();
    expect(screen.queryByLabelText("Fechar aba Histórico")).not.toBeNull();
  });

  test("Delete on a focused tab closes it", async () => {
    const store = await twoTabs();
    await act(async () => {
      fireEvent.keyDown(tab("Histórico"), { key: "Delete" });
    });
    expect(store.tabs.tabs).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Histórico, host alfa" })).toBeNull();
  });
});
