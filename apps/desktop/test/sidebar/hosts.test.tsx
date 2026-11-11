import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { Sidebar } = await import("../../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("sidebar-hosts: the nav and the hosts scroll as one body between a fixed header and footer (#171, #567)", () => {
  // How it scrolls, and the hosts' height, are measured by the e2e `layout-medido` journey.
  test("the sidebar marks the hosts section so a layout check can measure it", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const state = {
      ...store.getState(),
      hosts: [{ id: "h1", name: "alfa", status: "online", hostInfo: null, sessions: [] }],
    } as never as ReturnType<typeof store.getState>;
    const view = render(
      <Sidebar
        store={store}
        state={state}
        collapsed={false}
        t={store.i18n.t}
        go={() => {}}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
      />,
    );
    const hosts = view.container.querySelector("[data-slot='sidebar-hosts']");
    expect(hosts?.className).toContain("sidebar-hosts");
    expect(hosts?.textContent).toContain("alfa");
    // #567: the nav and the hosts sit in the one scrolling body; the footer stays outside it.
    const body = view.container.querySelector("[data-slot='sidebar-body']");
    const foot = view.container.querySelector("[data-slot='sidebar-foot']");
    expect(body?.className ?? "").toContain("sidebar-body");
    const navInBody = body?.querySelector("nav") != null;
    const hostsInBody = !!hosts && !!body?.contains(hosts);
    const footInBody = !!foot && !!body?.contains(foot);
    expect([navInBody, hostsInBody, !!foot, footInBody]).toEqual([true, true, true, false]);
    expect(foot?.textContent ?? "").toContain("Settings");
    // No other piece of the sidebar scrolls on its own.
    const scrollers = [...view.container.querySelectorAll("[class*='overflow-y-']")].length;
    expect(scrollers).toBe(0);
  });
});
