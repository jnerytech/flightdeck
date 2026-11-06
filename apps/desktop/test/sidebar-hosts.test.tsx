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

describe("sidebar-hosts: the hosts section keeps room when the grouped nav is tall (#171)", () => {
  test("the nav gives way and scrolls inside itself instead of pushing the hosts out", () => {
    const nav = block("sidebar-nav");
    expect(nav).toMatch(/min-height:\s*0/);
    expect(nav).toMatch(/overflow-y:\s*auto/);
    expect(nav).toMatch(/flex-shrink:\s*1/);
  });

  test("the hosts section has a minimum height of its own and scrolls when it has more rows", () => {
    const hosts = block("sidebar-hosts");
    expect(hosts).toMatch(/min-height:\s*(?:[6-9]|1\d)(?:\.\d+)?rem/);
    expect(hosts).toMatch(/overflow-y:\s*auto/);
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
  });
});
