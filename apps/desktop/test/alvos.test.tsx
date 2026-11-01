import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { HostsBanner } = await import("../src/components/hosts/hosts-banner.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);

/** The pointer targets of WCAG 2.5.8 are at least 24 px: `min-h-6` is 1.5 rem at the root size. */
const tall = (el: Element | null) => (el?.className ?? "").split(" ").includes("min-h-6");

describe("alvos: raw buttons keep a 24 px target", () => {
  test("the sidebar's section titles are 24 px tall", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(() => Bun.sleep(20));
    const titles = screen
      .queryAllByRole("button")
      .filter((b) => b.hasAttribute("aria-expanded") && b.className.includes("uppercase"));
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(tall(title)).toBe(true);
  });

  test("the hosts banner's toggle is 24 px tall", () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    const host = (id: string, status: string) => ({ id, name: id, status }) as never;
    render(<HostsBanner hosts={[host("caiu", "offline")]} t={store.i18n.t} />);
    expect(tall(screen.queryByRole("button", { name: "1 host com problema" }))).toBe(true);
  });
});
