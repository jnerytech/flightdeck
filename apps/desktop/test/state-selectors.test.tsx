import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Two reachable hosts and one that never answers, whose reconnect attempts flip its status. */
async function threeHosts() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 200 });
  cleanups.push(() => store.dispose());
  const alfa = legacyDaemon(cleanups);
  const beta = legacyDaemon(cleanups);
  await act(async () => {
    await store.addHost({ name: "alfa", url: alfa.url, token: TOKEN });
    await store.addHost({ name: "beta", url: beta.url, token: TOKEN });
    await store.addHost({ name: "gama", url: "ws://127.0.0.1:1/", token: TOKEN });
  });
  const deadline = Date.now() + 5000;
  while (
    store.getState().hosts.filter((h) => h.status === "online").length < 2 &&
    Date.now() < deadline
  ) {
    await act(() => Bun.sleep(10));
  }
  return { store, alfa, beta };
}

const listCalls = (daemon: { asked: string[] }) =>
  daemon.asked.filter((type) => type === "session.list").length;

describe("state-selectors: a quiet app does not refetch or redraw what did not change", () => {
  test("a host that keeps failing to connect does not make the hub ask the online hosts again", async () => {
    const { store, alfa, beta } = await threeHosts();
    render(<App store={store} />);
    await act(() => Bun.sleep(600));
    const before = [listCalls(alfa), listCalls(beta)];
    // The unreachable host changes status meanwhile: that is not a reason to ask the others.
    await act(() => Bun.sleep(2500));
    expect([listCalls(alfa), listCalls(beta)]).toEqual(before);
  });

  test("a refresh of the hub that finds the same lists keeps the state it had and tells nobody", async () => {
    const { store } = await threeHosts();
    await store.refreshHub();
    const first = store.getState();
    let told = 0;
    const stop = store.subscribe(() => told++);
    await store.refreshHub();
    stop();
    expect(told).toBe(0);
    const second = store.getState();
    expect(second.hub).toBe(first.hub);
    expect(second.meta).toBe(first.meta);
    expect(second.externals).toBe(first.externals);
    expect(second.names).toBe(first.names);
  });
});
