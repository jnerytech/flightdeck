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

const key = (k: string) =>
  act(async () => {
    fireEvent.keyDown(window, { key: k, ctrlKey: true });
  });

describe("abas-uma-linha: breadcrumb and tabs on one row", () => {
  test("with one area the tab strip sits in the top bar, next to the breadcrumb", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
    });
    const header = document.querySelector("header") as HTMLElement;
    const strip = screen.getByRole("tablist", { name: "Abas" });
    expect(header.contains(strip)).toBe(true);
    expect(header.contains(screen.getByRole("navigation", { name: "Você está em" }))).toBe(true);
    // The tab tools travel with the strip.
    expect(header.contains(screen.getByRole("button", { name: "Nova aba" }))).toBe(true);
  });

  test("a split gives each area its own strip, and joining brings the strip back to the top bar", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    const header = document.querySelector("header") as HTMLElement;
    await key("\\");
    const strips = screen.getAllByRole("tablist", { name: "Abas" });
    expect(strips).toHaveLength(2);
    for (const strip of strips) expect(header.contains(strip)).toBe(false);
    await key("\\");
    const [only] = screen.getAllByRole("tablist", { name: "Abas" });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(header.contains(only as HTMLElement)).toBe(true);
  });
});
