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
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup(terminals: boolean | "off" = true) {
  const d = makeDaemon(cleanups, terminals === false ? {} : { terminals });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: d.listen().url, token: TOKEN }));
  await waitFor(() => expect(store.getState().hosts[0]?.hostInfo).not.toBeNull());
  await act(async () => {
    store.router.push({ name: "host", host: hostId });
  });
  return { ...d, store, hostId };
}

const press = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
};

describe("terminal-ui: abrir um terminal", () => {
  test("the host page opens a new terminal in the host's folder, in a new tab", async () => {
    const { store, ptys, root } = await setup();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Novo terminal" })).not.toBeNull(),
    );
    await press("Novo terminal");
    await waitFor(() => expect(store.router.current.name).toBe("terminal"));
    expect(store.tabs.tabs).toHaveLength(2);
    expect(ptys.spawned[0]?.cwd).toBe(root);
  });

  test("the host page lists the live terminals, and Abrir opens one in a new tab", async () => {
    const { store, hostId, root } = await setup();
    const { terminalId } = await store.terminalHost(hostId).open(root, 80, 24);
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await act(async () => {
      store.router.push({ name: "host", host: hostId });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `Abrir o terminal em ${root}` })).not.toBeNull(),
    );
    await press(`Abrir o terminal em ${root}`);
    expect(store.router.current).toEqual({ name: "terminal", host: hostId, terminalId });
    expect(store.tabs.tabs).toHaveLength(2);
  });

  test("turned off, the page says so; turning them on asks first and then offers Novo terminal", async () => {
    await setup("off");
    await waitFor(() =>
      expect(screen.queryByText("Os terminais estão desligados neste host.")).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Novo terminal" })).toBeNull();
    await press("Ligar terminais");
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    const confirm = within(screen.getByRole("alertdialog")).queryByRole("button", {
      name: "Ligar terminais",
    });
    expect(confirm).not.toBeNull();
    await act(async () => {
      if (confirm) fireEvent.click(confirm);
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Novo terminal" })).not.toBeNull(),
    );
  });

  test("Desligar terminais asks, ends them and offers Ligar terminais again", async () => {
    const { store, hostId, root, ptys } = await setup();
    await store.terminalHost(hostId).open(root, 80, 24);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Desligar terminais" })).not.toBeNull(),
    );
    await press("Desligar terminais");
    const confirm = within(screen.getByRole("alertdialog")).queryByRole("button", {
      name: "Desligar terminais",
    });
    expect(confirm).not.toBeNull();
    await act(async () => {
      if (confirm) fireEvent.click(confirm);
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ligar terminais" })).not.toBeNull(),
    );
    expect(ptys.spawned[0]?.killed).toBe(true);
  });

  test("a daemon without terminals shows no terminal on its page nor in the palette", async () => {
    const { store } = await setup(false);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "pc" })).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
    await act(async () => store.openSearch());
    expect(screen.queryByRole("option", { name: "Novo terminal em pc" })).toBeNull();
  });

  test("the palette has Novo terminal em <host>, which opens one in a new tab", async () => {
    const { store } = await setup();
    await act(async () => store.openSearch());
    const option = screen.queryByRole("option", { name: "Novo terminal em pc" });
    expect(option).not.toBeNull();
    await act(async () => {
      if (option) fireEvent.click(option);
    });
    await waitFor(() => expect(store.router.current.name).toBe("terminal"));
    expect(store.tabs.tabs).toHaveLength(2);
  });

  test("the host page's list follows terminals opened and ended elsewhere", async () => {
    const { store, hostId, root } = await setup();
    const row = () => screen.queryByRole("button", { name: `Abrir o terminal em ${root}` });
    // The list asks again on a timer: let the time pass inside act, so its renders land.
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 20 && !check(); i++) {
        await act(async () => {
          await Bun.sleep(200);
        });
      }
    };
    await waitFor(() => expect(screen.queryByText("Nenhum terminal aberto.")).not.toBeNull());
    const { terminalId } = await store.terminalHost(hostId).open(root, 80, 24);
    await until(() => row() !== null);
    expect(row()).not.toBeNull();
    await store.terminalHost(hostId).close(terminalId, true);
    await until(() => row() === null);
    expect(row()).toBeNull();
  });

  test("Cancelar on the question changes nothing", async () => {
    const { store } = await setup("off");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ligar terminais" })).not.toBeNull(),
    );
    await press("Ligar terminais");
    const cancel = within(screen.getByRole("alertdialog")).queryByRole("button", {
      name: "Cancelar",
    });
    expect(cancel).not.toBeNull();
    await act(async () => {
      if (cancel) fireEvent.click(cancel);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.getState().hosts[0]?.hostInfo?.terminal?.enabled).toBe(false);
  });

  test("a list the host refuses (terminals turned off elsewhere) shows none", async () => {
    const { store, hostId, root } = await setup();
    const row = () => screen.queryByRole("button", { name: `Abrir o terminal em ${root}` });
    await store.terminalHost(hostId).open(root, 80, 24);
    for (let i = 0; i < 20 && row() === null; i++) {
      await act(async () => {
        await Bun.sleep(200);
      });
    }
    expect(row()).not.toBeNull();
    await store.hostCommand(hostId, "terminal.settings", { enabled: false });
    for (let i = 0; i < 20 && row() !== null; i++) {
      await act(async () => {
        await Bun.sleep(200);
      });
    }
    expect(row()).toBeNull();
  });
});
