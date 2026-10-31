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

async function setup() {
  const d = makeDaemon(cleanups, { terminals: true });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: d.listen().url, token: TOKEN }));
  await waitFor(() => expect(store.getState().hosts[0]?.hostInfo).not.toBeNull());
  const terminalId = await act(() => store.openTerminal(hostId));
  expect(terminalId).not.toBeNull();
  return { ...d, store, hostId, terminalId: terminalId as string };
}

const dialog = () => screen.queryByRole("alertdialog");
const inDialog = (name: string) =>
  dialog() ? within(dialog() as HTMLElement).queryByRole("button", { name }) : null;
const click = async (target: HTMLElement | null) => {
  expect(target).not.toBeNull();
  await act(async () => {
    if (target) fireEvent.click(target);
  });
};

describe("terminal-ui: fechar a aba de um terminal", () => {
  test("closing a terminal tab asks; Cancelar keeps it", async () => {
    const { store } = await setup();
    await click(screen.queryByLabelText("Fechar aba Terminal"));
    expect(dialog()).not.toBeNull();
    expect(inDialog("Desanexar")).not.toBeNull();
    expect(inDialog("Encerrar processo")).not.toBeNull();
    await click(inDialog("Cancelar"));
    expect(dialog()).toBeNull();
    expect(store.tabs.tabs).toHaveLength(2);
  });

  test("Desanexar closes the tab and keeps the terminal running on the host", async () => {
    const { store, hostId, ptys, terminalId } = await setup();
    await click(screen.queryByLabelText("Fechar aba Terminal"));
    await click(inDialog("Desanexar"));
    await waitFor(() => expect(store.tabs.tabs).toHaveLength(1));
    expect(ptys.spawned[0]?.killed).toBe(false);
    const live = await store.terminalHost(hostId).list();
    expect(live.map((terminal) => terminal.terminalId)).toEqual([terminalId]);
  });

  test("Ctrl+W on a terminal tab asks too; Encerrar processo ends it", async () => {
    const { store, ptys } = await setup();
    await act(async () => {
      fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    });
    expect(dialog()).not.toBeNull();
    await click(inDialog("Encerrar processo"));
    await waitFor(() => expect(store.tabs.tabs).toHaveLength(1));
    expect(ptys.spawned[0]?.killed).toBe(true);
  });

  test("the terminal screen's own close closes its tab instead of going back", async () => {
    const { store } = await setup();
    await waitFor(() => expect(screen.queryByText("Ao vivo")).not.toBeNull());
    await click(screen.queryByRole("button", { name: "Fechar terminal" }));
    await click(inDialog("Desanexar"));
    await waitFor(() => expect(store.tabs.tabs).toHaveLength(1));
  });
});
