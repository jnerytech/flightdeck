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

async function twoTabs() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  render(<App store={store} />);
  await act(async () => {
    store.tabs.open({ name: "needs-you" });
  });
  return store;
}

const closeButton = (title: string) => {
  const found = screen.queryByLabelText(`Fechar aba ${title}`);
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
const tab = (title: string) => {
  const found = screen.queryByRole("tab", { name: title });
  expect(found).not.toBeNull();
  return found as HTMLElement;
};

describe("abas: o × de cada aba", () => {
  test("every tab has its own close button, next to the tab and not inside it", async () => {
    await twoTabs();
    for (const title of ["Sessões", "Precisa de você"]) {
      const close = closeButton(title);
      expect(close.parentElement).toBe(tab(title).parentElement);
      expect(close.parentElement?.getAttribute("role")).toBe("presentation");
      expect(tab(title).querySelector("button")).toBeNull();
      // axe refuses a button among the tabs of a tablist: the mouse gets the ×, the keyboard and
      // the screen reader get Delete (announced on the tab).
      expect(close.getAttribute("aria-hidden")).toBe("true");
      expect(close.getAttribute("tabindex")).toBe("-1");
      expect(tab(title).getAttribute("aria-keyshortcuts")).toBe("Delete");
      expect(close.className).toContain("size-6");
    }
  });

  test("closing a tab that is not the active one closes it and keeps the active tab", async () => {
    const store = await twoTabs();
    const active = store.tabs.activeId;
    await act(async () => {
      fireEvent.click(closeButton("Sessões"));
    });
    expect(store.tabs.tabs.map((t) => t.id)).toEqual([active]);
    expect(store.tabs.activeId).toBe(active);
  });

  test("a pinned tab has no close button", async () => {
    const store = await twoTabs();
    await act(async () => {
      store.tabs.pin(store.tabs.activeId, true);
    });
    expect(screen.queryByLabelText("Fechar aba Precisa de você")).toBeNull();
    expect(screen.queryByLabelText("Fechar aba Sessões")).not.toBeNull();
  });

  test("the × shows on the active tab, and on the others under the pointer or the keyboard focus", async () => {
    await twoTabs();
    expect(closeButton("Precisa de você").className).not.toContain("opacity-0");
    const other = closeButton("Sessões").className;
    expect(other).toContain("opacity-0");
    expect(other).toContain("group-hover:opacity-100");
    expect(other).toContain("group-focus-within:opacity-100");
  });

  test("Delete on a focused tab closes it", async () => {
    const store = await twoTabs();
    await act(async () => {
      fireEvent.keyDown(tab("Sessões"), { key: "Delete" });
    });
    expect(store.tabs.tabs).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Sessões" })).toBeNull();
  });

  test("a tab shows its hover and keyboard focus states", async () => {
    await twoTabs();
    const className = tab("Sessões").className;
    expect(className).toContain("hover:");
    expect(className).toContain("focus-visible:ring");
  });
});
