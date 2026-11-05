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

  const hostUi = (store: InstanceType<typeof AppStore>, hostId: string) =>
    store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui;

  test("Given the panel, Then a state line says which mode the host opens in and whether it is locked", async () => {
    await hostPage({ mode: "full", locked: true });
    expect(screen.getByText("This host opens in: Full app")).toBeTruthy();
    expect(screen.getByText("Lock: on (people stay in the default mode)")).toBeTruthy();
    cleanup();
    await hostPage({ mode: "full", locked: false });
    expect(screen.getByText("This host opens in: Full app")).toBeTruthy();
    expect(screen.getByText("Lock: off")).toBeTruthy();
  });

  test("Given an unlocked host in full mode, When Simple is picked as the default, Then the control, the line and a toast follow, and the person's own view stays", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: false });
    const group = screen.getByRole("radiogroup", { name: "Default mode" });
    expect(
      (within(group).getByRole("radio", { name: "Full app" }) as HTMLInputElement).checked,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "Simple mode" }));
    });
    await waitFor(() => expect(hostUi(store, hostId)?.mode).toBe("simple"));
    expect(
      (within(group).getByRole("radio", { name: "Simple mode" }) as HTMLInputElement).checked,
    ).toBe(true);
    await waitFor(() => screen.getByText("Simple mode is now the default for pc"));
    expect(screen.getByText("This host opens in: Simple mode")).toBeTruthy();
    expect(store.uiMode(hostId).mode).toBe("full");
  });

  test("Given an unlocked host, When the lock switch is turned on and confirmed, Then the host is locked and says so in a toast and in its sidebar row", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: false });
    const lock = screen.getByRole("switch", { name: "Lock this host to its mode" });
    expect(lock.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(lock);
    });
    await click("Lock");
    await waitFor(() => expect(hostUi(store, hostId)?.locked).toBe(true));
    await waitFor(() => screen.getByText("pc is now locked to its mode"));
    expect(
      screen
        .getByRole("switch", { name: "Lock this host to its mode" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("img", { name: "pc: locked to its mode" })).toBeTruthy();
  });

  test("Given the lock question, When it is cancelled, Then the host stays unlocked and the switch stays off", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Lock this host to its mode" }));
    });
    await click("Cancel");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(hostUi(store, hostId)?.locked).toBe(false);
    expect(
      screen
        .getByRole("switch", { name: "Lock this host to its mode" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  test("Given a host locked to full, Then the page offers no way into simple mode and no choice of default, only the switch to unlock", async () => {
    const { store, hostId } = await hostPage({ mode: "full", locked: true });
    expect(screen.queryByRole("button", { name: "Use simple mode on this host" })).toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Default mode" }).querySelector("input:disabled"),
    ).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Lock this host to its mode" }));
    });
    await waitFor(() => expect(hostUi(store, hostId)?.locked).toBe(false));
    await waitFor(() => screen.getByText("pc is open again: people can choose their mode"));
  });

  test("Given a host that defaults to simple mode, Then its sidebar row carries a Simple badge", async () => {
    const { store, hostId } = await hostPage({ mode: "simple", locked: false });
    await act(async () => {
      store.setUiChoice(hostId, "full");
    });
    await waitFor(() =>
      expect(
        screen.getByText("Simple", { selector: "[data-slot='host-mode-badge']" }),
      ).toBeTruthy(),
    );
  });
});
