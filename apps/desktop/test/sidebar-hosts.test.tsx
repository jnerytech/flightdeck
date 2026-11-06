import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const block = (name: string) => css.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";

describe("sidebar-hosts: the nav and the hosts scroll as one body between a fixed header and footer (#171, #567)", () => {
  test("the body takes the room left and scrolls; the nav and the hosts inside it do not scroll on their own", () => {
    const body = block("sidebar-body");
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/flex:\s*1 1 0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(/overflow/.test(block("sidebar-nav"))).toBe(false);
    expect(/overflow/.test(block("sidebar-hosts"))).toBe(false);
  });

  test("the hosts section still has a minimum height of its own (#171)", () => {
    expect(block("sidebar-hosts")).toMatch(/min-height:\s*(?:[6-9]|1\d)(?:\.\d+)?rem/);
  });

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
