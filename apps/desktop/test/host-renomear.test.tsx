import { afterEach, describe, expect, test } from "bun:test";
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

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";

async function setup() {
  const d = makeDaemon(cleanups, {});
  const server = d.listen(0, 20);
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await act(() => store.addHost({ name: "wsl", url: server.url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull());
  return { store, ...mem };
}

const click = (el: HTMLElement | null) =>
  act(async () => {
    expect(el).not.toBeNull();
    if (el) fireEvent.click(el);
  });

/** Opens the sidebar menu of host `name` and picks Renomear. */
async function renameFromMenu(name: string) {
  const trigger = screen.queryByRole("button", { name: `Menu de ${name}` });
  await act(async () => {
    if (trigger) {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
    }
  });
  await click(await waitFor(() => screen.getByRole("menuitem", { name: "Renomear" })));
}

const field = () => screen.queryByLabelText("Nome do host") as HTMLInputElement | null;
const type = (value: string) =>
  act(async () => {
    if (field()) fireEvent.change(field() as HTMLInputElement, { target: { value } });
  });
const save = () => click(screen.queryByRole("button", { name: "Salvar nome" }));

describe("host-renomear", () => {
  test("the sidebar menu renames a host: trimmed, saved, shown everywhere at once", async () => {
    const { store, items } = await setup();
    await renameFromMenu("pc");
    expect(field()?.value).toBe("pc");
    await type("  Windows  ");
    await save();
    expect(store.getState().hosts[0]?.name).toBe("Windows");
    expect(items.get("flightdeck.hosts")).toContain('"name":"Windows"');
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Windows: online")).not.toBeNull();
  });

  test("an empty name is refused with a message, and the dialog stays open", async () => {
    const { store } = await setup();
    await renameFromMenu("pc");
    await type("   ");
    await save();
    expect(text()).toContain("Digite um nome para o host.");
    expect(store.getState().hosts[0]?.name).toBe("pc");
    expect(field()).not.toBeNull();
  });

  test("a name another host has is refused, ignoring case", async () => {
    const { store } = await setup();
    await renameFromMenu("pc");
    await type("WSL");
    await save();
    expect(text()).toContain("Já existe um host com esse nome.");
    expect(store.getState().hosts[0]?.name).toBe("pc");
  });

  test("Esc cancels without renaming", async () => {
    const { store } = await setup();
    await renameFromMenu("pc");
    await type("outro");
    await act(async () => {
      fireEvent.keyDown(field() as HTMLElement, { key: "Escape" });
    });
    expect(field()).toBeNull();
    expect(store.getState().hosts[0]?.name).toBe("pc");
  });

  test("the host page header has Renomear too, and no longer a name field in the body", async () => {
    const { store } = await setup();
    await click(screen.queryByRole("button", { name: "Abrir host pc" }));
    expect(field()).toBeNull();
    await click(screen.queryByRole("button", { name: "Renomear" }));
    await type("Notebook");
    await save();
    expect(store.getState().hosts[0]?.name).toBe("Notebook");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Notebook" })).not.toBeNull());
  });
});
