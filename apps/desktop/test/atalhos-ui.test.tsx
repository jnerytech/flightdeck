import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

async function mount(language = "en") {
  // One host that never answers: with no host at all the app shows the add-host form instead.
  const mem = memoryPlatform(false, language);
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  render(<App store={store} />);
  await act(async () => {});
  const names = () => store.tabs.tabs.map((tab) => tab.router.current.name);
  const press = async (key: string, target: Element = document.body) => {
    await act(async () => void fireEvent.keyDown(target, { key }));
  };
  return { store, names, press };
}

const sheet = () => screen.queryByRole("dialog", { name: /Keyboard shortcuts|Atalhos de teclado/ });

describe("atalhos-ui: the ? sheet and the go-to chords", () => {
  test("? opens the sheet with the shortcuts by group, with the keys beside each", async () => {
    const { store, press } = await mount();
    expect(sheet()).toBeNull();
    await press("?");
    const open = within(sheet() as HTMLElement);
    expect(open.queryByRole("heading", { name: "Go to" })).not.toBeNull();
    expect(open.queryByText("Open the command palette")).not.toBeNull();
    expect(open.queryByText("Ctrl+K")).not.toBeNull();
    expect(open.queryByText("Go to Projects")).not.toBeNull();
    expect(open.queryByText("g p")).not.toBeNull();
    store.dispose();
  });

  test("Escape and the close button close it", async () => {
    const { store, press } = await mount();
    await press("?");
    await press("Escape", sheet() as HTMLElement);
    expect(sheet()).toBeNull();
    await press("?");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close the shortcuts" }));
    });
    expect(sheet()).toBeNull();
    store.dispose();
  });

  test("g then p opens the Projects overview; g then s the Sessions", async () => {
    const { store, names, press } = await mount();
    await press("g");
    await press("p");
    expect(names()).toEqual(["all-projects"]);
    await press("g");
    await press("s");
    expect(names()).toEqual(["hub"]);
    await press("g");
    await press("n");
    expect(names()).toEqual(["needs-you"]);
    store.dispose();
  });

  test("typing in a field never fires a chord or the sheet", async () => {
    const { store, names, press } = await mount();
    const field = document.createElement("input");
    document.body.append(field);
    await press("g", field);
    await press("p", field);
    await press("?", field);
    expect(names()).not.toContain("all-projects");
    expect(sheet()).toBeNull();
    field.remove();
    store.dispose();
  });

  test("in Portuguese the sheet and its labels follow the dictionary", async () => {
    const { store, press } = await mount("pt-BR");
    await press("?");
    const open = within(sheet() as HTMLElement);
    expect(open.queryByText("Ir para Projetos")).not.toBeNull();
    expect(open.queryByRole("heading", { name: "Ir para" })).not.toBeNull();
    store.dispose();
  });
});
