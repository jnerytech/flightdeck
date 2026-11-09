import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { StatusBarSlot } = await import("../src/components/shell/status-bar.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

/**
 * Issue #1484: the status bar's Pause and Keep awake items open the host's Settings at their own
 * section, with the focus on it, not the host's Overview.
 */
describe("status bar items open their host section (#1484)", () => {
  test("the Pause and Keep awake items ask for the host page at their section", async () => {
    const asked: object[] = [];
    const host = {
      id: "h1",
      name: "pi",
      url: "ws://x",
      token: "",
      status: "online",
      info: null,
      hostInfo: {
        daemonVersion: "x",
        features: ["hostPause", "keepAwake"],
        pause: { paused: true, running: 2 },
        keepAwake: { enabled: true, held: true, method: "systemd-inhibit", reason: null },
      },
      incompatibility: null,
      daemonUpdate: null,
      sessions: [],
    };
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    cleanups.push(() => store.dispose());
    store.i18n.start();
    render(
      <StatusBarSlot
        t={store.i18n.t}
        state={{ hosts: [host], quota: {}, appUpdate: {}, settings: {} } as never}
        now={0}
        terminalTabs={0}
        refreshing={false}
        onRefreshQuota={() => {}}
        onOpenTerminals={() => {}}
        go={(route) => void asked.push(route)}
      />,
    );
    const pause = screen.queryByRole("button", { name: /New runs paused on pi/ });
    const awake = screen.queryByRole("button", { name: /Keep awake: holding/ });
    // Booleans keep DOM nodes out of the failure diff.
    expect([pause === null, awake === null]).toEqual([false, false]);
    await act(async () => {
      fireEvent.click(pause as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(awake as HTMLElement);
    });
    expect(asked).toEqual([
      { name: "host", host: "h1", section: "pause" },
      { name: "host", host: "h1", section: "keep-awake" },
    ]);
  });

  test("a host route with a section opens Settings and puts the focus on that section", async () => {
    const d = makeDaemon(cleanups, { keepAwake: {} });
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => store.router.push({ name: "host", host: hostId, section: "keep-awake" }));
    await settle(() => document.activeElement?.textContent === "Keep this computer awake");
    const settings = screen.queryByRole("tab", { name: "Settings" });
    expect(settings?.getAttribute("aria-selected")).toBe("true");
  });
});
