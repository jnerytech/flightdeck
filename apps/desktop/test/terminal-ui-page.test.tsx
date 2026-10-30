import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";
import { fakeXterm } from "./terminal-fakes.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TerminalPage } = await import("../src/ui/TerminalPage.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(listFails = false) {
  const d = makeDaemon(cleanups, { terminals: true });
  const server = d.listen();
  const mem = memoryPlatform(false, "pt-BR");
  const copied: string[] = [];
  mem.platform.copyText = async (text) => void copied.push(text);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const { terminalId } = await store.terminalHost(hostId).open(d.project, 80, 24);
  if (listFails) {
    const real = store.terminalHost.bind(store);
    store.terminalHost = (id) => ({
      ...real(id),
      list: async () => {
        throw new Error("recusado");
      },
    });
  }
  const x = fakeXterm();
  const closed: number[] = [];
  render(
    <TContext.Provider value={store.i18n.t}>
      <TerminalPage
        store={store}
        hostId={hostId}
        terminalId={terminalId}
        deps={x.deps}
        onClosed={() => void closed.push(1)}
      />
    </TContext.Provider>,
  );
  return { ...d, server, store, hostId, terminalId, x, closed, copied };
}

const state = (name: string) => screen.queryByText(name);
const button = (name: string) => screen.queryByRole("button", { name });
const click = async (name: string) => {
  const target = button(name);
  expect(target).not.toBeNull();
  await act(async () => {
    if (target) fireEvent.click(target);
  });
};
const settle = (check: () => unknown) => waitFor(() => check()).catch(() => null);

describe("terminal-ui: the terminal screen", () => {
  test("attaches, shows it live and draws the host's output and the keys' echo", async () => {
    const { x, ptys } = await setup();
    await settle(() => state("Ao vivo"));
    expect(state("Ao vivo")).not.toBeNull();
    ptys.spawned[0]?.emit("saída\r\n");
    await settle(() => x.drawn.includes("saída\r\n"));
    expect(x.drawn).toContain("saída\r\n");
    act(() => x.type("ls\r"));
    await settle(() => ptys.spawned[0]?.written.includes("ls\r"));
    expect(ptys.spawned[0]?.written).toContain("ls\r");
  });

  test("a terminal that ends shows its code and Reabrir attaches it again", async () => {
    const { x, ptys } = await setup();
    await settle(() => state("Ao vivo"));
    ptys.spawned[0]?.exit(2);
    await settle(() => state("Encerrado (código 2)"));
    expect(state("Encerrado (código 2)")).not.toBeNull();
    const before = x.drawn.filter((entry) => entry === "<reset>").length;
    await click("Reabrir");
    await settle(() => x.drawn.filter((entry) => entry === "<reset>").length > before);
    expect(x.drawn.filter((entry) => entry === "<reset>").length).toBeGreaterThan(before);
  });

  test("losing the host shows it detached, with Reabrir", async () => {
    const { server } = await setup();
    await settle(() => state("Ao vivo"));
    server.stop();
    await settle(() => state("Desanexado"));
    expect(state("Desanexado")).not.toBeNull();
    expect(button("Reabrir")).not.toBeNull();
  });

  test("Ctrl+Shift+F opens the search: Enter goes to the next match, Shift+Enter to the previous, Esc closes", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" });
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(box as HTMLElement, { target: { value: "erro" } });
      fireEvent.keyDown(box as HTMLElement, { key: "Enter" });
      fireEvent.keyDown(box as HTMLElement, { key: "Enter", shiftKey: true });
    });
    expect(x.finds).toContain("next:erro");
    expect(x.finds).toContain("prev:erro");
    await act(async () => {
      fireEvent.keyDown(box as HTMLElement, { key: "Escape" });
    });
    expect(screen.queryByRole("searchbox", { name: "Buscar no terminal" })).toBeNull();
    expect(x.finds.at(-1)).toBe("clear");
  });

  test("closing asks: Desanexar keeps the process, Encerrar processo ends it, Cancelar does nothing", async () => {
    const { x, ptys, closed } = await setup();
    await settle(() => state("Ao vivo"));
    await click("Fechar terminal");
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    await click("Cancelar");
    expect(closed).toEqual([]);
    await click("Fechar terminal");
    await click("Desanexar");
    await settle(() => closed.length === 1);
    expect(closed).toEqual([1]);
    expect(ptys.spawned[0]?.killed).toBe(false);
    expect(x.disposed()).toBe(false);
  });

  test("Encerrar processo kills it", async () => {
    const { ptys, closed } = await setup();
    await settle(() => state("Ao vivo"));
    await click("Fechar terminal");
    await click("Encerrar processo");
    await settle(() => closed.length === 1);
    expect(ptys.spawned[0]?.killed).toBe(true);
    expect(closed).toEqual([1]);
  });

  test("leaving the screen releases xterm", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    cleanup();
    expect(x.disposed()).toBe(true);
  });

  test("the font size comes from the settings and follows them", async () => {
    const { x, store } = await setup();
    await settle(() => state("Ao vivo"));
    expect(x.fonts()).toEqual([13]);
    act(() => store.terminalFont.set(18));
    await settle(() => x.terminal.options.fontSize === 18);
    expect(x.terminal.options.fontSize).toBe(18);
  });

  test("Ctrl+Shift+C copies the selection through the app and Ctrl+Shift+V pastes the clipboard", async () => {
    const { x, copied } = await setup();
    await settle(() => state("Ao vivo"));
    x.select("linha copiada");
    const clipboard = navigator.clipboard as unknown as { readText?: () => Promise<string> };
    const saved = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { ...clipboard, readText: async () => "colado" },
    });
    try {
      await act(async () => {
        x.chord("C");
        x.chord("V");
        await Bun.sleep(5);
      });
    } finally {
      if (saved) Object.defineProperty(navigator, "clipboard", saved);
    }
    expect(copied).toEqual(["linha copiada"]);
    expect(x.pasted).toEqual(["colado"]);
  });

  test("a resync from the host attaches again; a frame of a terminal nobody follows is ignored", async () => {
    const { x, store, hostId, terminalId } = await setup();
    await settle(() => state("Ao vivo"));
    const conn = (
      store as unknown as {
        connections: Map<string, { opts: { onTerminal(frame: object): void } }>;
      }
    ).connections.get(hostId);
    const resets = () => x.drawn.filter((entry) => entry === "<reset>").length;
    const before = resets();
    await act(async () => {
      conn?.opts.onTerminal({ type: "terminal.data", terminalId: "ninguem", data: "eA==" });
      conn?.opts.onTerminal({ type: "terminal.resync", terminalId });
    });
    await settle(() => resets() > before);
    expect(resets()).toBe(before + 1);
  });

  test("the terminal fits its box again when the box changes size", async () => {
    const observers: Array<() => void> = [];
    const saved = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const { x } = await setup();
      await settle(() => state("Ao vivo"));
      const before = x.fits();
      act(() => {
        for (const callback of observers) callback();
      });
      expect(x.fits()).toBeGreaterThan(before);
    } finally {
      globalThis.ResizeObserver = saved;
    }
  });

  test("a host that refuses the list of terminals leaves the screen live, without Ver como sessão", async () => {
    const { store, hostId } = await setup(true);
    await settle(() => state("Ao vivo"));
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        externals: {
          [`${hostId}/c1`]: {
            claudeSessionId: "c1",
            cwd: "/p",
            transcriptPath: null,
            source: null,
            status: "idle",
            statusReason: null,
            launchId: "L1",
            controllable: true,
            projectKey: null,
            startedAt: "2026-10-30T12:00:00Z",
            lastEventAt: "2026-10-30T12:00:00Z",
            endedAt: null,
          },
        },
      });
      await Bun.sleep(20);
    });
    expect(state("Ao vivo")).not.toBeNull();
    expect(button("Ver como sessão")).toBeNull();
  });

  test("a new size of xterm reaches the host, debounced", async () => {
    const { x, ptys } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => {
      x.resize(100, 30);
      x.resize(120, 40);
    });
    await settle(() => (ptys.spawned[0]?.resized.length ?? 0) > 0);
    expect(ptys.spawned[0]?.resized).toEqual([[120, 40]]);
  });

  test("the right button opens a menu with Copiar and Colar", async () => {
    const { x, copied } = await setup();
    await settle(() => state("Ao vivo"));
    x.select("trecho");
    const area = document.querySelector("[data-terminal-area]") as HTMLElement | null;
    expect(area).not.toBeNull();
    await act(async () => {
      if (area) fireEvent.contextMenu(area, { clientX: 40, clientY: 50 });
    });
    expect(screen.queryByRole("menu", { name: "Terminal" })).not.toBeNull();
    await click("Copiar");
    expect(copied).toEqual(["trecho"]);
    expect(screen.queryByRole("menu", { name: "Terminal" })).toBeNull();
    await act(async () => {
      if (area) fireEvent.contextMenu(area, { clientX: 40, clientY: 50 });
    });
    await act(async () => {
      fireEvent.keyDown(screen.queryByRole("menu", { name: "Terminal" }) as HTMLElement, {
        key: "Escape",
      });
    });
    expect(screen.queryByRole("menu", { name: "Terminal" })).toBeNull();
  });

  test("a link in the output opens in the browser, http and https only", async () => {
    const { x, store } = await setup();
    await settle(() => state("Ao vivo"));
    const opened: string[] = [];
    (
      store as unknown as { platform: { openExternal(url: string): Promise<void> } }
    ).platform.openExternal = async (url) => void opened.push(url);
    x.clickLink("https://example.com/a");
    x.clickLink("file:///etc/passwd");
    expect(opened).toEqual(["https://example.com/a"]);
  });
});
