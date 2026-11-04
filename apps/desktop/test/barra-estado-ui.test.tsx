import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { StatusBar } = await import("../src/components/shell/status-bar.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

const host = (id: string, name: string, status: string) => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status,
  info: null,
  hostInfo: { daemonVersion: "x", features: ["quota"] },
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

function setup(withQuota = true) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const state = {
    hosts: [host("a", "alfa", "online"), host("b", "beta", "online"), host("c", "gama", "offline")],
    quota: withQuota
      ? {
          a: {
            pauseAt: null,
            windows: [
              {
                window: "seven_day",
                utilization: 0.78,
                status: "allowed",
                resetsAt: new Date(NOW + 3 * DAY + 9 * HOUR).toISOString(),
                readAt: new Date(NOW).toISOString(),
              },
            ],
          },
        }
      : {},
  } as never;
  let refreshed = 0;
  const view = (
    <TooltipProvider>
      <StatusBar store={store} state={state} onRefresh={() => refreshed++} />
    </TooltipProvider>
  );
  return { view, refreshed: () => refreshed };
}

describe("barra-estado-ui: the bottom bar", () => {
  test("it shows the quota at a glance and how many hosts are online", () => {
    const { view } = setup();
    render(view);
    const bar = screen.getByLabelText("Status bar");
    expect(bar.textContent).toContain("78% · 3d 9h");
    expect(bar.textContent).toContain("Hosts online: 2/3");
  });

  test("without a reading it says so, and Refresh asks for the lists again", async () => {
    const { view, refreshed } = setup(false);
    render(view);
    const bar = screen.getByLabelText("Status bar");
    expect(bar.textContent).toContain("Quota: no reading");
    await act(
      async () => void fireEvent.click(within(bar).getByRole("button", { name: "Refresh status" })),
    );
    expect(refreshed()).toBe(1);
  });

  test("the app carries the bar under the content, with its host online", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    });
    await pollFor(() => store.getState().hosts[0]?.status === "online" || undefined, "online");
    const bar = await pollFor(
      () => screen.queryByLabelText("Barra de status") ?? undefined,
      "the bar",
    );
    expect(bar.textContent).toContain("Hosts online: 1/1");
    await act(
      async () =>
        void fireEvent.click(within(bar).getByRole("button", { name: "Atualizar status" })),
    );
  });
});
