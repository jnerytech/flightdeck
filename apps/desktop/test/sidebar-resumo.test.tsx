import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = (over: object = {}) => ({
  id: "h1",
  name: "alfa",
  status: "online",
  hostInfo: { daemonVersion: "x", features: [] },
  sessions: [],
  ...over,
});

function setup(options: { hosts?: object[]; deps?: object; folded?: boolean } = {}) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  if (options.folded !== false) store.setSidebarFolded(["machines"]);
  const state = {
    ...store.getState(),
    hosts: options.hosts ?? [host()],
    deps: options.deps ?? {},
  } as never as ReturnType<typeof store.getState>;
  const view = (collapsed = false) => (
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      t={store.i18n.t}
      go={() => {}}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />
  );
  return { store, view };
}

const heading = () =>
  within(screen.getByRole("group", { name: "Machines" })).getByRole("button", {
    name: /Machines/,
  });
const summary = () => within(heading()).queryByRole("img", { name: "A machine needs attention" });

describe("sidebar-resumo: a folded Machines group still says when a machine needs attention (issue #208)", () => {
  test("an offline machine puts a dot on the folded title", () => {
    render(setup({ hosts: [host({ status: "offline" })] }).view());
    expect(heading().getAttribute("aria-expanded")).toBe("false");
    expect(summary()).not.toBeNull();
  });

  test("so do a missing required dependency and a forwarded API key", () => {
    render(
      setup({
        deps: { h1: { items: [{ id: "folders", group: "required", state: "missing" }] } },
      }).view(),
    );
    expect(summary()).not.toBeNull();
    cleanup();
    render(
      setup({
        hosts: [host({ hostInfo: { daemonVersion: "x", features: [], apiKeySanitized: false } })],
      }).view(),
    );
    expect(summary()).not.toBeNull();
  });

  test("a healthy set of machines has no dot, and an unfolded group shows its own markers instead", async () => {
    render(setup().view());
    expect(summary()).toBeNull();
    cleanup();
    const open = setup({ hosts: [host({ status: "offline" })], folded: false });
    render(open.view());
    expect(heading().getAttribute("aria-expanded")).toBe("true");
    expect(summary()).toBeNull();
  });

  test("unfolding the group takes the dot away and the host's own marker is in view", async () => {
    render(setup({ hosts: [host({ status: "offline" })] }).view());
    await act(async () => {
      fireEvent.click(heading());
    });
    expect(summary()).toBeNull();
    expect(screen.queryByLabelText("alfa: offline")).not.toBeNull();
  });
});
