import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(6000);

async function setup() {
  const d = makeDaemon(cleanups, {});
  const { sessionId } = await d.manager.create({ cwd: d.project, prompt: "oi", name: "Alpha" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  const server = d.listen();
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => {
    store.router.push({ name: "activity" });
  });
  await settle(() => screen.queryByRole("checkbox", { name: "Show idle sessions" }) !== null);
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: "Show idle sessions" }));
  });
  const card = () =>
    document.querySelector("[data-slot='activity-card'] button") as HTMLElement | null;
  await settle(() => card() !== null);
  return { store, sessionId, card };
}

describe("activity-app: the board inside the app", () => {
  // The board is a shared screen, so a session opened from it lands in its host's own tabs and the
  // board keeps its tab: there is no "same tab" or "new tab" to choose between from a shared tab.
  const opensInHostTabs = async (
    { store, sessionId, card }: Awaited<ReturnType<typeof setup>>,
    init: { ctrlKey?: boolean },
  ) => {
    await act(async () => {
      fireEvent.click(card() as HTMLElement, init);
    });
    await settle(() => store.router.current.name === "session");
    expect(store.router.current).toMatchObject({ name: "session", id: sessionId });
    expect(store.hostTabs.onShared).toBe(false);
    expect(store.hostTabs.shared.tabs.map((tab) => tab.router.current.name)).toContain("activity");
    expect(store.tabs.tabs.map((tab) => tab.router.current.name)).toEqual(["session"]);
  };

  test("a click on a card opens its session in its host's tabs, and the board keeps its tab", async () => {
    await opensInHostTabs(await setup(), {});
  });

  test("Ctrl-click on a card opens its session in its host's tabs too", async () => {
    await opensInHostTabs(await setup(), { ctrlKey: true });
  });
});
