import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup() {
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
  return { ...d, store, hostId };
}

/** A Radix menu opens on pointer down; then its entry is clicked. */
async function menu(trigger: string, entry: string) {
  const button = screen.queryByRole("button", { name: trigger });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(button as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(button as HTMLElement);
  });
  const item = screen.queryByRole("menuitem", { name: entry });
  expect(item).not.toBeNull();
  await act(async () => {
    fireEvent.click(item as HTMLElement);
  });
}

describe("abas: Abrir em nova aba nos menus", () => {
  test("the host's menu opens its page in a new tab", async () => {
    const { store, hostId } = await setup();
    await menu("Menu de alfa", "Abrir em nova aba");
    expect(store.tabs.tabs).toHaveLength(2);
    expect(store.router.current).toEqual({ name: "host", host: hostId });
  });

  test("a session row's menu opens it in a new tab", async () => {
    const { store, hostId, project } = await setup();
    const sessionId = await act(() =>
      store.createSession(hostId, { cwd: project, prompt: "oi", name: "s1" }),
    );
    await waitFor(() =>
      expect(
        store.getState().hub[hostId]?.managed.find((m) => m.id === sessionId)?.claudeSessionId,
      ).toBeTruthy(),
    );
    await act(async () => {
      store.tabs.open({ name: "hub" });
    });
    const before = store.tabs.tabs.length;
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ações de s1" })).not.toBeNull(),
    );
    await menu("Ações de s1", "Abrir em nova aba");
    expect(store.tabs.tabs).toHaveLength(before + 1);
    expect(store.router.current).toEqual({
      name: "session",
      host: hostId,
      id: sessionId as string,
    });
  });
});
