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

/** A host that says what it says about its mode, an app on it, in English. */
async function open(
  ui?: { mode: "full" | "simple"; locked: boolean },
  mem = memoryPlatform(false, "en"),
) {
  const d = makeDaemon(cleanups, { simple: true, ...(ui ? { ui } : {}) });
  const server = d.listen();
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");
  return { store, hostId, mem, d };
}

const nav = () => screen.getByRole("navigation", { name: "Simple mode" });

describe("mode-switch-ui: the app opens in the host's mode", () => {
  test("Given a host set to simple, Then the app shows Home with templates and a narrow menu of three, and none of the full app's screens", async () => {
    await open({ mode: "simple", locked: false });
    await waitFor(() => screen.getByRole("heading", { name: "What do you want done?" }));
    expect(
      within(nav())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Home", "Files", "Settings"]);
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Workflows" })).toBeNull();
    await waitFor(() => screen.getByRole("button", { name: /Summarise a folder/ }));
  });

  test("Given a host in full mode, Then the app is the full app", async () => {
    await open({ mode: "full", locked: false });
    await waitFor(() => screen.getByRole("button", { name: "Board" }));
    expect(screen.queryByRole("navigation", { name: "Simple mode" })).toBeNull();
  });

  test("Given simple mode, When Show everything is confirmed, Then the full app opens at once and the choice is kept", async () => {
    const { store, hostId, mem } = await open({ mode: "simple", locked: false });
    await act(async () => {
      fireEvent.click(within(nav()).getByRole("button", { name: "Settings" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Show everything" }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Show everything" }),
      );
    });
    await waitFor(() => screen.getByRole("button", { name: "Board" }));
    expect(store.uiMode(hostId).mode).toBe("full");
    expect(mem.items.get("flightdeck.uiMode")).toContain('"full"');
  });

  test("Given a locked simple host, Then Settings offers no way out", async () => {
    await open({ mode: "simple", locked: true });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    });
    await waitFor(() => screen.getByRole("heading", { name: "Language" }));
    expect(screen.queryByRole("button", { name: "Show everything" })).toBeNull();
  });

  test("Given simple Settings, When the theme, a folder and notifications are changed, Then the app's store takes each", async () => {
    const { store, d } = await open({ mode: "simple", locked: false });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    });
    await waitFor(() => screen.getByRole("heading", { name: "Language" }));
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
        target: { value: "dark" },
      });
    });
    expect(store.theme.mode).toBe("dark");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Tell me when a task needs my answer or is done" }),
      );
    });
    await waitFor(() => expect(store.getState().settings.notifyUpdates).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder to add" }), {
      target: { value: d.root },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Folder to add" }) as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  test("Given a platform with a folder dialog, When Choose folder is pressed in Settings, Then the pick fills the box", async () => {
    const mem = memoryPlatform(false, "en");
    mem.platform.pickFolder = async () => "/tmp/picked";
    await open({ mode: "simple", locked: false }, mem);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Folder to add" }) as HTMLInputElement).value,
      ).toBe("/tmp/picked"),
    );
  });
});
