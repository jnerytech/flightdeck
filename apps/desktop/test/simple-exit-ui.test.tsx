import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SHORTCUTS } from "../src/lib/shortcuts.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** An app on a host with the given mode settings, in English. */
async function open(ui: { mode: "full" | "simple"; locked: boolean }) {
  const d = makeDaemon(cleanups, { simple: true, ui });
  const server = d.listen();
  const store = new AppStore(memoryPlatform(false, "en").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");
  return { store, hostId };
}

const nav = () => screen.getByRole("navigation", { name: "Simple mode" });
const key = (init: KeyboardEventInit) =>
  act(async () => {
    fireEvent.keyDown(document.body, { key: "M", ctrlKey: true, shiftKey: true, ...init });
  });

describe("simple-exit-ui: simple mode has a visible way out (issue #132)", () => {
  test("Given an unlocked simple host, Then the nav ends with a Full app item that asks once and switches", async () => {
    const { store, hostId } = await open({ mode: "simple", locked: false });
    const item = await waitFor(() => within(nav()).getByRole("button", { name: "Full app" }), {
      timeout: 10_000,
    });
    await act(async () => {
      fireEvent.click(item);
    });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("This shows the technical screens.")).toBeTruthy();
    expect(store.uiMode(hostId).mode).toBe("simple");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Show everything" }));
    });
    await waitFor(() => screen.getByRole("button", { name: "Board" }));
    expect(store.uiMode(hostId).mode).toBe("full");
  });

  test("Given a locked simple host, Then the nav says why there is no way out, and offers none", async () => {
    await open({ mode: "simple", locked: true });
    await waitFor(() => within(nav()).getByText(/Ask its admin to unlock it/), { timeout: 10_000 });
    expect(
      within(nav()).getByText("This host is set to simple mode. Ask its admin to unlock it."),
    ).toBeTruthy();
    expect(within(nav()).queryByRole("button", { name: "Full app" })).toBeNull();
  });

  test("Given the full app on a host that allows it, Then the sidebar's footer has a Simple mode item, and the round trip keeps the open tab", async () => {
    const { store, hostId } = await open({ mode: "full", locked: false });
    await act(async () => {
      store.tabs.open({ name: "costs" });
    });
    const tabs = store.tabs.tabs.map((tab) => tab.id);
    const active = store.tabs.activeId;
    await act(async () => {
      fireEvent.click(
        await waitFor(() => screen.getByRole("button", { name: "Simple mode" }), {
          timeout: 10_000,
        }),
      );
    });
    await waitFor(() => nav());
    expect(store.uiMode(hostId).mode).toBe("simple");
    await act(async () => {
      fireEvent.click(within(nav()).getByRole("button", { name: "Full app" }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Show everything" }),
      );
    });
    await waitFor(() => screen.getByRole("button", { name: "Board" }));
    expect(store.tabs.tabs.map((tab) => tab.id)).toEqual(tabs);
    expect(store.tabs.activeId).toBe(active);
  });

  test("Given a locked full host, Then the footer has no Simple mode item", async () => {
    await open({ mode: "full", locked: true });
    await waitFor(() => screen.getByRole("button", { name: "Board" }), { timeout: 10_000 });
    expect(screen.queryByRole("button", { name: "Simple mode" })).toBeNull();
  });

  test("Ctrl+Shift+M switches the mode of an unlocked host both ways, and does nothing on a locked one", async () => {
    const { store, hostId } = await open({ mode: "full", locked: false });
    await waitFor(() => screen.getByRole("button", { name: "Board" }), { timeout: 10_000 });
    await key({});
    await waitFor(() => expect(store.uiMode(hostId).mode).toBe("simple"));
    await key({});
    await waitFor(() => expect(store.uiMode(hostId).mode).toBe("full"));
  });

  test("Ctrl+Shift+M on a locked host does nothing", async () => {
    const { store, hostId } = await open({ mode: "full", locked: true });
    await waitFor(() => screen.getByRole("button", { name: "Board" }), { timeout: 10_000 });
    await key({});
    expect(store.uiMode(hostId).mode).toBe("full");
  });

  test("the shortcut is in the sheet and the palette has an entry that follows the mode", async () => {
    expect(SHORTCUTS.find((s) => s.id === "toggle-mode")?.keys).toEqual(["Mod", "Shift", "M"]);
    await open({ mode: "full", locked: false });
    await waitFor(() => screen.getByRole("button", { name: "Board" }), { timeout: 10_000 });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    });
    await waitFor(() => screen.getByRole("option", { name: /Switch to simple mode/ }), {
      timeout: 10_000,
    });
  });
});
