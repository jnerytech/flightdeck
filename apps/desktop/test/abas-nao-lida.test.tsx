import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const unread = () => screen.queryByText("Não lida", { selector: "[role=tab] [data-badge]" });

describe("abas: não lida", () => {
  test("a reply in a session whose tab is in the background marks it unread until it is shown", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() =>
      store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN }),
    );
    await waitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"));
    const sessionId = (await act(() =>
      store.createSession(hostId, { cwd: d.project, prompt: "oi", name: "s1" }),
    )) as string;
    const key = sessionKey(hostId, sessionId);
    await waitFor(() => expect(store.getState().sessions[key]?.status).toBe("idle"));
    const sessionTab = store.tabs.activeId;
    expect(unread()).toBeNull();
    await act(async () => {
      store.tabs.open({ name: "hub" });
      await store.send("de novo");
    });
    await waitFor(() => expect(unread()).not.toBeNull());
    await act(async () => {
      store.tabs.activate(sessionTab);
    });
    expect(unread()).toBeNull();
    expect(store.getState().unread[key]).toBeUndefined();
  });

  test("a reply in the session on screen is not unread", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() =>
      store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN }),
    );
    await waitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"));
    const sessionId = (await act(() =>
      store.createSession(hostId, { cwd: d.project, prompt: "oi", name: "s1" }),
    )) as string;
    const key = sessionKey(hostId, sessionId);
    await waitFor(() => expect(store.getState().sessions[key]?.status).toBe("idle"));
    await act(async () => {
      await store.send("de novo");
    });
    await waitFor(() =>
      expect(store.getState().sessions[key]?.items.filter((i) => i.kind === "result")).toHaveLength(
        2,
      ),
    );
    expect(store.getState().unread[key]).toBeUndefined();
  });
});
