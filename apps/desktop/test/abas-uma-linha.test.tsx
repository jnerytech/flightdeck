import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

/** happy-dom's viewport, and the moment its media queries follow it. */
async function viewport(width: number, height: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height,
    });
  });
  await settle(() => window.matchMedia("(max-height: 599px)").matches === height < 600);
  await act(async () => {});
}

afterEach(async () => {
  cleanup();
  await viewport(1024, 768);
});

const key = (k: string) =>
  act(async () => {
    fireEvent.keyDown(window, { key: k, ctrlKey: true });
  });

// Issue #488: the tabs left the top bar for a row of their own over the area (the header gave them
// 124 px at 1280), in one area as in a split, as VS Code and Orca do.
describe("abas-uma-linha: the tabs have a row of their own under the top bar", () => {
  test("with one area the tab strip sits over the area, not in the top bar with the breadcrumb", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    const header = document.querySelector("header") as HTMLElement;
    const strip = screen.getByRole("tablist", { name: "Abas" });
    expect(header.contains(strip)).toBe(false);
    expect(header.contains(screen.getByRole("navigation", { name: "Você está em" }))).toBe(true);
    // The tab tools travel with the strip.
    expect(header.contains(screen.getByRole("button", { name: "Nova aba" }))).toBe(false);
    expect(strip.closest("section[aria-label]")).not.toBeNull();
  });

  test("a split gives each area its own strip, and joining keeps the one strip over its area", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    const header = document.querySelector("header") as HTMLElement;
    // A split belongs to a host's own window: open one of its screens first.
    await act(async () => {
      store.hostTabs.open({ name: "history", host: "ha" });
    });
    await key("\\");
    const strips = screen.getAllByRole("tablist", { name: "Abas" });
    expect(strips).toHaveLength(2);
    for (const strip of strips) expect(header.contains(strip)).toBe(false);
    await key("\\");
    const [only] = screen.getAllByRole("tablist", { name: "Abas" });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(header.contains(only as HTMLElement)).toBe(false);
  });

  // A 720x480 window keeps its conversation at least 150 px tall (the layout journey): under 600 px
  // high the one area's tabs stay in the top bar's row, as before #488.
  test("in a window under 600 px tall the one area's strip sits in the top bar again", async () => {
    await viewport(720, 480);
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    const header = document.querySelector("header") as HTMLElement;
    const strip = screen.queryByRole("tablist", { name: "Abas" });
    expect(strip !== null && header.contains(strip)).toBe(true);
  });
});
