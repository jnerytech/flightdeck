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
const { paletteSections } = await import("../src/lib/palette.ts");
const { translator } = await import("../src/i18n/index.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("segundo-host: adding another host (issue #185, J2)", () => {
  test("the second host lands on its own page, like the first one", async () => {
    const first = makeDaemon(cleanups);
    const second = makeDaemon(cleanups);
    const firstServer = first.listen();
    const secondServer = second.listen();
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(() => store.addHost({ name: "one", url: firstServer.url, token: TOKEN }));
    await act(async () => {
      store.tabs.active.router.push({ name: "add-host" });
    });
    const port = String(new URL(secondServer.url.replace("ws://", "http://")).port);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "two" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "127.0.0.1" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: port } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: TOKEN } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test and add" }));
    });
    await rtlWaitFor(() => expect(store.tabs.active.router.current.name).toBe("host"), {
      timeout: 4000,
    });
    expect(screen.queryByRole("heading", { name: "two" })).not.toBeNull();
  });
});

describe("segundo-host: Add host is a palette command", () => {
  const state = {
    hosts: [],
    sessions: {},
    hub: {},
    externals: {},
    meta: {},
    cards: {},
    projects: {},
    ssh: {},
  };

  test("the palette lists it, and it goes to the add-host form", () => {
    const sections = paletteSections(state as never, "", {
      costs: false,
      t: translator("en"),
      waiting: false,
    });
    const found = sections.flatMap((s) => s.items).find((i) => i.label === "Add a host");
    expect(found?.target).toEqual({ kind: "add-host" });
  });

  test("searching host finds it", () => {
    const sections = paletteSections(state as never, "host", {
      costs: false,
      t: translator("en"),
      waiting: false,
    });
    expect(sections.flatMap((s) => s.items).map((i) => i.label)).toContain("Add a host");
  });
});

describe("segundo-host: the palette command goes to the add-host form", () => {
  test("choosing Adicionar um host in the palette opens the form", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.active.router.push({ name: "settings" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const input = document.querySelector("dialog input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "host" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(store.tabs.active.router.current.name).toBe("add-host");
  });
});
