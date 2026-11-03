import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import type { PendingItem } from "../src/lib/app-store.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function build(language = "en") {
  const mem = memoryPlatform(false, language);
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  return { store, mem };
}

async function mount(language = "en") {
  const built = build(language);
  render(<App store={built.store} />);
  await act(async () => {});
  const names = () => built.store.tabs.tabs.map((tab) => tab.router.current.name);
  return { ...built, names };
}

const palette = () => screen.queryByRole("dialog", { name: /Global search|Busca global/ });
const openPalette = async () => {
  await act(async () => void fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
  expect(palette()).not.toBeNull();
};
const option = (label: string) =>
  within(palette() as HTMLElement).queryByRole("option", { name: label }) as HTMLElement;

describe("paleta-v2-ui: commands, hints and recents", () => {
  test("a command shows its keys at the right, and Enter on it goes there", async () => {
    const { store, names } = await mount();
    await openPalette();
    expect(within(option("Go to Projects")).queryByText("g p")).not.toBeNull();
    await act(async () => void fireEvent.click(option("Go to Projects")));
    expect(names()).toEqual(["all-projects"]);
    store.dispose();
  });

  test("Show the keyboard shortcuts opens the sheet", async () => {
    const { store } = await mount();
    await openPalette();
    await act(async () => void fireEvent.click(option("Show the keyboard shortcuts")));
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeNull();
    store.dispose();
  });

  test("what was used comes back under Recent when the palette opens again", async () => {
    const { store } = await mount();
    await openPalette();
    expect(within(palette() as HTMLElement).queryByRole("heading", { name: "Recent" })).toBeNull();
    await act(async () => void fireEvent.click(option("Go to Projects")));
    await openPalette();
    const recent = within(palette() as HTMLElement).getByRole("listbox", { name: "Recent" });
    expect(within(recent).queryByRole("option", { name: "Go to Projects" })).not.toBeNull();
    store.dispose();
  });

  test("the recents outlive the app: a new store over the same storage has them", async () => {
    const { store, mem } = await mount();
    await openPalette();
    await act(async () => void fireEvent.click(option("Go to Projects")));
    store.dispose();
    cleanup();
    const again = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    expect(again.paletteRecents()).toEqual(["go:all-projects"]);
    again.dispose();
  });

  test("in Portuguese the commands follow the dictionary", async () => {
    const { store } = await mount("pt-BR");
    await openPalette();
    expect(option("Ir para Projetos")).not.toBeNull();
    expect(option("Mostrar os atalhos de teclado")).not.toBeNull();
    store.dispose();
  });
});

const request = (over: Partial<PendingItem>): PendingItem => ({
  hostId: "h1",
  hostName: "alfa",
  sessionId: "s1",
  sessionName: "Alpha",
  requestId: "r1",
  toolName: "Bash",
  createdAt: "2026-11-02T10:00:00Z",
  ...over,
});

/** A store whose waiting requests are `items`, with the answers recorded. */
function storeWith(items: PendingItem[]) {
  const { store } = build();
  const answered: Array<[string, string, string]> = [];
  const opened: string[] = [];
  const hidden = store as unknown as {
    state: unknown;
    respondTo(hostId: string, requestId: string, decision: string): Promise<void>;
  };
  hidden.state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        sessions: [
          {
            id: "s1",
            name: "Alpha",
            cwd: "/p",
            status: "idle",
            pendingPermissions: items.map((i) => ({
              requestId: i.requestId,
              toolName: i.toolName,
              createdAt: i.createdAt,
              ...(i.risk ? { risk: i.risk } : {}),
            })),
          },
        ],
      },
    ],
  };
  hidden.respondTo = async (hostId, requestId, decision) => {
    answered.push([hostId, requestId, decision]);
  };
  store.onOpenRequest((item) => opened.push(item.requestId));
  return { store, answered, opened };
}

describe("paleta-v2-ui: approve and deny the oldest request", () => {
  test("approve answers allow and deny answers deny, for the first waiting request", () => {
    const { store, answered } = storeWith([
      request({ requestId: "r1" }),
      request({ requestId: "r2", createdAt: "2026-11-02T11:00:00Z" }),
    ]);
    store.decideOldest("approve");
    store.decideOldest("deny");
    expect(answered).toEqual([
      ["h1", "r1", "allow"],
      ["h1", "r1", "deny"],
    ]);
  });

  test("a high-risk request is opened to be held, never approved from here", () => {
    const { store, answered, opened } = storeWith([request({ requestId: "r1", risk: "high" })]);
    store.decideOldest("approve");
    expect(answered).toEqual([]);
    expect(opened).toEqual(["r1"]);
    store.decideOldest("deny");
    expect(answered).toEqual([["h1", "r1", "deny"]]);
  });

  test("with nothing waiting it does nothing", () => {
    const { store, answered, opened } = storeWith([]);
    store.decideOldest("approve");
    expect([answered, opened]).toEqual([[], []]);
  });
});
