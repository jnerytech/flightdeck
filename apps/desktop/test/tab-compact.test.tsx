import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { hostColorVar } from "../src/lib/host-color.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const settle = waiter(4000);

/** happy-dom evaluates media queries against its viewport and fires `change` on resize. */
async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  await settle(() => window.matchMedia("(width < 640px)").matches === width < 640);
  await act(async () => {});
}

afterEach(async () => {
  cleanup();
  await viewport(1024);
});

/** One host, "alfa", with four tabs in the row: Sessões (shared), its Overview, History and Projects. */
async function mount() {
  const mem = memoryPlatform(false, "pt-BR");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {
    store.hostTabs.open({ name: "host", host: "ha" });
    store.hostTabs.open({ name: "history", host: "ha" });
    store.hostTabs.open({ name: "projects", host: "ha" });
  });
  return store;
}

const strip = () => screen.queryByRole("tablist", { name: "Abas" });
/** The one button of a narrow window's tab row: the current tab, and how many there are. */
const current = () =>
  screen
    .queryAllByRole("button")
    .find((b) => /^Todas as abas \(\d+\), atual:/.test(b.getAttribute("aria-label") ?? ""));

// Issue #644: under 640 px the row is one button, not a strip to scroll.
describe("tab-compact: below 640 px the tab row is one button for the current tab", () => {
  test("it shows the current tab's icon, title, host dot and the tab count, and the strip is gone", async () => {
    await mount();
    await viewport(390);
    expect(strip() === null).toBe(true);
    const button = current() as HTMLElement;
    expect(button === undefined).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Todas as abas (4), atual: Projetos, host alfa");
    expect(button.textContent).toContain("Projetos");
    expect(button.textContent).toContain("4");
    expect(button.querySelector("svg") === null).toBe(false);
    const dot = button.querySelector<HTMLElement>("[data-host-dot]");
    expect(dot?.style.backgroundColor).toBe(hostColorVar("ha"));
  });

  test("it opens the list of all tabs across the window, and picking a tab goes to it and closes the list", async () => {
    const store = await mount();
    await viewport(390);
    expect(current() === undefined).toBe(false);
    await act(async () => {
      fireEvent.click(current() as HTMLElement);
    });
    const dialog = screen.queryByRole("dialog", { name: "Todas as abas" }) as HTMLElement;
    expect(dialog === null).toBe(false);
    const options = screen.queryAllByRole("option");
    expect(options).toHaveLength(4);
    await act(async () => {
      fireEvent.click(
        options.find((o) => (o.textContent ?? "").includes("Histórico")) as HTMLElement,
      );
    });
    expect(store.router.current.name).toBe("history");
    expect(screen.queryByRole("dialog", { name: "Todas as abas" }) === null).toBe(true);
    expect(current()?.getAttribute("aria-label")).toBe(
      "Todas as abas (4), atual: Histórico, host alfa",
    );
  });

  test("on a shared screen it shows that screen with no host dot", async () => {
    const store = await mount();
    await viewport(390);
    await act(async () => {
      store.hostTabs.activate(store.hostTabs.shared.tabs[0]?.id ?? "");
    });
    expect(current()?.getAttribute("aria-label")).toBe("Todas as abas (4), atual: Sessões");
    expect(current()?.querySelector("[data-host-dot]") === null).toBe(true);
  });

  test("a new tab stays one tap away, and the split's buttons are not offered", async () => {
    await mount();
    await viewport(390);
    expect(screen.queryByRole("button", { name: "Nova aba" }) === null).toBe(false);
    expect(screen.queryByRole("button", { name: "Dividir a tela" }) === null).toBe(true);
  });

  test("from 640 px the strip is back, and the button is gone", async () => {
    await mount();
    await viewport(390);
    await viewport(700);
    expect(strip() === null).toBe(false);
    expect(current() === undefined).toBe(true);
    expect(screen.queryByRole("button", { name: "Dividir a tela" }) === null).toBe(false);
  });
  test("a window that was split can still be joined, and the split is not offered otherwise", async () => {
    const store = await mount();
    await act(async () => {
      store.workspace.toggleSplit();
    });
    await viewport(390);
    expect(screen.queryByRole("button", { name: "Juntar as áreas" }) === null).toBe(false);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Juntar as áreas" }) as HTMLElement);
    });
    expect(store.workspace.split).toBeNull();
    expect(screen.queryByRole("button", { name: "Dividir a tela" }) === null).toBe(true);
  });

  test("the current tab keeps its menu: pin, move and the rest", async () => {
    await mount();
    await viewport(390);
    const menu = screen.queryByRole("button", { name: "Ações da aba Projetos" });
    expect(menu === null).toBe(false);
    await act(async () => {
      fireEvent.pointerDown(menu as HTMLElement, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
      fireEvent.click(menu as HTMLElement);
    });
    expect(screen.queryByRole("menuitem", { name: "Fixar aba Projetos" }) === null).toBe(false);
  });

  test("a host not known by name is not named by its id", async () => {
    const store = await mount();
    await viewport(390);
    await act(async () => {
      store.hostTabs.open({ name: "history", host: "ghost" });
    });
    // The row keeps working: the title stands alone, without the id.
    expect(current()?.getAttribute("aria-label") ?? "").not.toContain("ghost");
  });
});
