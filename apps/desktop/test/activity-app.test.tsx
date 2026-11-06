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
  test("a click on a card opens its session in the same tab", async () => {
    const { store, sessionId, card } = await setup();
    const tabs = store.tabs.tabs.length;
    await act(async () => {
      fireEvent.click(card() as HTMLElement);
    });
    await settle(() => store.router.current.name === "session");
    expect(store.router.current).toMatchObject({ name: "session", id: sessionId });
    expect(store.tabs.tabs.length).toBe(tabs);
  });

  test("Ctrl-click on a card opens its session in a new tab", async () => {
    const { store, sessionId, card } = await setup();
    const tabs = store.tabs.tabs.length;
    await act(async () => {
      fireEvent.click(card() as HTMLElement, { ctrlKey: true });
    });
    await settle(() => store.router.current.name === "session");
    expect(store.router.current).toMatchObject({ name: "session", id: sessionId });
    expect(store.tabs.tabs.length).toBe(tabs + 1);
  });
});
