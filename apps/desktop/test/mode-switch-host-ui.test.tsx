import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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

/** A full-mode app on a host with the given mode settings, on the host's own page. */
async function hostPage(ui: { mode: "full" | "simple"; locked: boolean }) {
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
  await act(async () => store.router.push({ name: "host", host: hostId }));
  return { store, hostId };
}

const click = async (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

describe("mode-switch-host-ui: the host's own page offers simple mode", () => {
  test("Given a host in full mode, When the person picks simple mode, Then the app shows Home and the choice is kept", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: false });
    await click("Use simple mode on this host");
    await waitFor(() => screen.getByRole("heading", { name: "What do you want done?" }));
    expect(store.uiMode(hostId).mode).toBe("simple");
  });

  test("Given an unlocked host, When the default is set to simple and the host is locked, Then the host says so", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: false });
    await click("Make simple mode the default for this host");
    await waitFor(() =>
      expect(store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui?.mode).toBe(
        "simple",
      ),
    );
    await click("Lock this host to its mode");
    await click("Lock");
    await waitFor(() =>
      expect(store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui?.locked).toBe(true),
    );
  });

  test("Given a host locked to full, Then the page offers no way into simple mode, only to unlock", async () => {
    await hostPage({ mode: "full", locked: true });
    expect(screen.queryByRole("button", { name: "Use simple mode on this host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlock this host's mode" })).not.toBeNull();
  });

  test("Given the lock question, When it is cancelled, Then the host stays unlocked", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: false });
    await click("Lock this host to its mode");
    await click("Cancel");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui?.locked).toBe(false);
  });

  test("Given a locked host, When it is unlocked, Then the host says it is open again", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: true });
    await click("Unlock this host's mode");
    await waitFor(() =>
      expect(store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui?.locked).toBe(false),
    );
  });
});

/** Two hosts, "one" first; the app on the page of the second. */
async function secondHostPage() {
  const first = makeDaemon(cleanups, { simple: true, ui: { mode: "full", locked: false } });
  const second = makeDaemon(cleanups, { simple: true, ui: { mode: "full", locked: false } });
  const store = new AppStore(memoryPlatform(false, "en").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const one = await act(() =>
    store.addHost({ name: "one", url: first.listen().url, token: TOKEN }),
  );
  const two = await act(() =>
    store.addHost({ name: "two", url: second.listen().url, token: TOKEN }),
  );
  for (const id of [one, two]) {
    await pollFor(() => store.getState().hosts.find((h) => h.id === id)?.hostInfo, "host info");
  }
  await act(async () => store.router.push({ name: "host", host: two }));
  return { store, one, two };
}

describe("mode-switch-host-ui: simple mode follows the host whose page it was chosen on (issue #191, J8)", () => {
  test("Given two hosts, When simple mode is chosen on the second one's page, Then that host is the one in simple mode", async () => {
    const { store, one, two } = await secondHostPage();
    await click("Use simple mode on this host");
    await waitFor(() => screen.getByRole("heading", { name: "What do you want done?" }));
    expect(store.getState().selected?.hostId).toBe(two);
    expect(store.uiMode(two).mode).toBe("simple");
    expect(store.uiMode(one).mode).toBe("full");
  });

  test("Given simple mode, When something fails, Then the failure shows as a notice", async () => {
    const { store } = await secondHostPage();
    await click("Use simple mode on this host");
    await waitFor(() => screen.getByRole("heading", { name: "What do you want done?" }));
    await act(async () => {
      store.reportError("the task could not start");
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("the task could not start"),
    );
  });
});
