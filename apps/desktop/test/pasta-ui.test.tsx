import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
const { FolderPicker } = await import("../src/ui/FolderPicker.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup(options: { native?: (root: string) => string; remote?: boolean } = {}) {
  const d = makeDaemon(cleanups);
  for (const dir of ["alfa", "beta", ".oculta", "alfa/interna"]) {
    mkdirSync(join(d.root, dir), { recursive: true });
  }
  writeFileSync(join(d.root, "arquivo.txt"), "x");
  const mem = memoryPlatform(false, "pt-BR");
  if (options.native) {
    const pick = options.native;
    (mem.platform as { pickFolder?: () => Promise<string | null> }).pickFolder = async () =>
      pick(d.root);
  }
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"));
  const view = store.getState().hosts[0];
  const host = options.remote && view ? { ...view, url: "ws://100.64.0.9:7420/v1/ws" } : view;
  const picked: string[] = [];
  let closed = 0;
  render(
    <TContext.Provider value={store.i18n.t}>
      <FolderPicker
        store={store}
        host={host as NonNullable<typeof host>}
        onPick={(path) => void picked.push(path)}
        onClose={() => void closed++}
      />
    </TContext.Provider>,
  );
  return { ...d, store, hostId, picked, closed: () => closed };
}

const dialog = () => screen.queryByRole("dialog", { name: "Escolher pasta" });
const button = (name: string | RegExp) =>
  within(dialog() as HTMLElement).queryByRole("button", { name });
/** Whether the dialog has that button; a plain boolean, because a failed `expect` on an element dumps the whole DOM and starves the socket. */
const shown = (name: string | RegExp) => button(name) !== null;
const press = async (name: string | RegExp) => {
  await waitFor(() => expect(shown(name)).toBe(true));
  await act(async () => {
    fireEvent.click(button(name) as HTMLElement);
  });
};

describe("pasta: escolher uma pasta do host", () => {
  test("it opens on the host's allowed folders, in a dialog", async () => {
    const { root } = await setup();
    await waitFor(() => expect(dialog()).not.toBeNull());
    await waitFor(() => expect(button(new RegExp(`^${basename(root)}`))).not.toBeNull());
    expect(within(dialog() as HTMLElement).queryByText("Pastas do host")).not.toBeNull();
  });

  test("a folder opens into its subfolders: no files, no hidden ones, and a breadcrumb back", async () => {
    const { root } = await setup();
    const rootName = basename(root);
    await press(new RegExp(`^${rootName}`));
    await waitFor(() => expect(shown("alfa")).toBe(true));
    expect(shown("beta")).toBe(true);
    expect(shown("arquivo.txt")).toBe(false);
    expect(shown(".oculta")).toBe(false);
    await press("alfa");
    await waitFor(() => expect(shown("interna")).toBe(true));
    // The breadcrumb names every step; the one above goes back.
    await press(rootName);
    await waitFor(() => expect(shown("beta")).toBe(true));
    await press("Pastas do host");
    await waitFor(() => expect(shown("beta")).toBe(false));
    expect(shown(new RegExp(`^${rootName}`))).toBe(true);
  });

  test("Escolher esta pasta hands over the real path; at the list of roots it is disabled and says why", async () => {
    const { root, picked } = await setup();
    const rootName = basename(root);
    await waitFor(() => expect(shown("Escolher esta pasta")).toBe(true));
    expect((button("Escolher esta pasta") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog() as HTMLElement).queryByText("Abra uma pasta primeiro")).not.toBeNull();
    await press(new RegExp(`^${rootName}`));
    await press("alfa");
    await waitFor(() => expect(shown("interna")).toBe(true));
    await press("Escolher esta pasta");
    expect(picked).toEqual([join(root, "alfa")]);
  });

  test("hidden folders show when asked", async () => {
    const { root } = await setup();
    await press(new RegExp(`^${basename(root)}`));
    await waitFor(() => expect(shown("alfa")).toBe(true));
    const toggle = within(dialog() as HTMLElement).queryByRole("checkbox", {
      name: "Mostrar pastas ocultas",
    });
    expect(toggle).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle as HTMLElement);
    });
    await waitFor(() => expect(shown(".oculta")).toBe(true));
  });

  test("the arrow keys walk the list, Enter opens a folder and Backspace goes up", async () => {
    const { root } = await setup();
    await press(new RegExp(`^${basename(root)}`));
    await waitFor(() => expect(shown("alfa")).toBe(true));
    const list = within(dialog() as HTMLElement).queryByRole("list", { name: "Pastas" });
    expect(list).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(list as HTMLElement, { key: "ArrowDown" });
    });
    expect(document.activeElement?.textContent).toBe("alfa");
    await act(async () => {
      fireEvent.keyDown(list as HTMLElement, { key: "ArrowDown" });
    });
    expect(document.activeElement?.textContent).toBe("beta");
    await act(async () => {
      fireEvent.keyDown(list as HTMLElement, { key: "ArrowUp" });
      fireEvent.keyDown(list as HTMLElement, { key: "Enter" });
    });
    await waitFor(() => expect(shown("interna")).toBe(true));
    await act(async () => {
      fireEvent.keyDown(list as HTMLElement, { key: "Backspace" });
    });
    await waitFor(() => expect(shown("beta")).toBe(true));
  });

  test("a folder the host refuses says so, with the folders it allows", async () => {
    const { root } = await setup({ native: (dir) => dirname(dir) });
    await press("Escolher no sistema");
    await waitFor(() =>
      expect(within(dialog() as HTMLElement).queryByRole("alert")).not.toBeNull(),
    );
    const text = within(dialog() as HTMLElement).queryByRole("alert")?.textContent ?? "";
    expect(text).toContain("fora das pastas que o host permite");
    expect(text).toContain(root);
  });

  test("on this machine the system dialog is offered, and what it picks is checked by the host", async () => {
    const { root, picked } = await setup({ native: (dir) => join(dir, "beta") });
    await press("Escolher no sistema");
    await waitFor(() => expect(picked).toEqual([join(root, "beta")]));
  });

  test("a remote host has no system dialog (it would pick a folder of this machine)", async () => {
    await setup({ native: () => "/x", remote: true });
    await waitFor(() => expect(shown("Escolher esta pasta")).toBe(true));
    expect(shown("Escolher no sistema")).toBe(false);
  });

  test("Cancelar and Esc close it", async () => {
    const { closed } = await setup();
    await press("Cancelar");
    expect(closed()).toBe(1);
  });

  test("an empty folder says so; a folder with more than 500 says it was cut; a key it does not know does nothing", async () => {
    const { root } = await setup();
    mkdirSync(join(root, "many"));
    for (let i = 0; i < 501; i++) mkdirSync(join(root, "many", `d${String(i).padStart(3, "0")}`));
    await press(new RegExp(`^${basename(root)}`));
    await press("alfa");
    await press("interna");
    await waitFor(() =>
      expect(within(dialog() as HTMLElement).queryByText("Nenhuma subpasta aqui.") !== null).toBe(
        true,
      ),
    );
    const list = within(dialog() as HTMLElement).queryByRole("list", {
      name: "Pastas",
    }) as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(list, { key: "a" });
    });
    await press("Pastas do host");
    await press(new RegExp(`^${basename(root)}`));
    await press("many");
    await waitFor(() =>
      expect(
        within(dialog() as HTMLElement).queryByText(/Só as primeiras 500 pastas/) !== null,
      ).toBe(true),
    );
  });

  test("the up button (it has a name) goes to the folder above, and Esc closes the picker", async () => {
    const { root, closed } = await setup();
    await press(new RegExp(`^${basename(root)}`));
    await press("alfa");
    await waitFor(() => expect(shown("interna")).toBe(true));
    await press("Subir um nível");
    await waitFor(() => expect(shown("beta")).toBe(true));
    await act(async () => {
      fireEvent.keyDown(dialog() as HTMLElement, { key: "Escape" });
    });
    await waitFor(() => expect(closed()).toBe(1));
  });
});
