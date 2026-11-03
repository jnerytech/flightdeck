import { afterEach, describe, expect, test } from "bun:test";
import { Profiler } from "react";
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
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 8000 });
const text = () => document.body.textContent ?? "";
/** How many times the app committed a render: an idle app must not keep adding to it. */
let commits = 0;

async function setup() {
  const d = makeDaemon(cleanups, {});
  const server = d.listen(0, 20);
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  commits = 0;
  render(
    <Profiler id="app" onRender={() => commits++}>
      <App store={store} />
    </Profiler>,
  );
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
const button = (name: string) => waitFor(() => screen.getByRole("button", { name }));

/** Opens the sidebar menu of host `name` and picks Renomear. */
async function renameFromMenu(name: string) {
  const trigger = await waitFor(() => screen.getByRole("button", { name: `Menu de ${name}` }));
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
  await click(await waitFor(() => screen.getByRole("menuitem", { name: "Renomear" })));
}

const field = () => screen.queryByLabelText("Nome do host") as HTMLInputElement | null;
const type = async (value: string) => {
  await waitFor(() => expect(field()).not.toBeNull());
  await act(async () => {
    fireEvent.change(field() as HTMLInputElement, { target: { value } });
  });
  // Outside act the input's state is flushed a tick later: let it land before anything submits.
  await act(() => Bun.sleep(50));
};
const save = async () => click(await button("Salvar nome"));

describe("host-renomear", () => {
  test("the sidebar menu renames a host: trimmed, saved, shown everywhere at once", async () => {
    const { store, items } = await setup();
    await renameFromMenu("pc");
    await waitFor(() => expect(field()?.value).toBe("pc"));
    await type("  Windows  ");
    await save();
    expect(store.getState().hosts[0]?.name).toBe("Windows");
    expect(items.get("flightdeck.hosts")).toContain('"name":"Windows"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.queryByLabelText("Windows: online")).not.toBeNull());
  }, 15_000);

  test("an empty name is refused with a message, and the dialog stays open", async () => {
    const { store } = await setup();
    await renameFromMenu("pc");
    await type("   ");
    await save();
    await waitFor(() => expect(text()).toContain("Digite um nome para o host."));
    expect(store.getState().hosts[0]?.name).toBe("pc");
    expect(field()).not.toBeNull();
  }, 15_000);

  test("a name another host has is refused, ignoring case", async () => {
    const { store } = await setup();
    await renameFromMenu("pc");
    await type("WSL");
    await save();
    await waitFor(() => expect(text()).toContain("Já existe um host com esse nome."));
    expect(store.getState().hosts[0]?.name).toBe("pc");
  }, 15_000);

  test("Esc cancels without renaming", async () => {
    const { store } = await setup();
    await renameFromMenu("pc");
    await type("outro");
    await act(async () => {
      fireEvent.keyDown(field() as HTMLElement, { key: "Escape" });
    });
    await waitFor(() => expect(field()).toBeNull());
    expect(store.getState().hosts[0]?.name).toBe("pc");
  }, 15_000);

  test("the host page header has Renomear too, and no longer a name field in the body", async () => {
    const { store } = await setup();
    await click(await button("Abrir host pc"));
    await click(await button("Renomear"));
    await type("Notebook");
    await save();
    expect(store.getState().hosts[0]?.name).toBe("Notebook");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Notebook" })).not.toBeNull());
    // The body no longer has a name field of its own.
    await waitFor(() => expect(field()).toBeNull());
  }, 15_000);
});

describe("host-renomear: the app is quiet while nothing happens", () => {
  // A daemon pinging every 20 ms made the app commit dozens of renders a second. React's `act`
  // only settles when the queue is empty, so on a slow runner (or after a heavy file in the same
  // process) it waited seconds for a gap and the menu clicks of the rename tests ran out of time.
  test("two online hosts, left alone for 700 ms, commit almost no renders", async () => {
    await setup();
    await act(() => Bun.sleep(100));
    const before = commits;
    await act(() => Bun.sleep(700));
    expect(commits - before).toBeLessThanOrEqual(3);
  });
});
