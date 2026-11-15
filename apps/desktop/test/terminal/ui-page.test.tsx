import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../fixtures.ts";
import {
  act,
  button,
  cleanup,
  click,
  escapeReachesPageUnhandled,
  fireEvent,
  hookSession,
  runCleanups,
  screen,
  settle,
  setup,
  state,
} from "./page-setup.tsx";

setDefaultTimeout(30_000);
afterEach(runCleanups);

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

  test("the terminal does not scroll with the page", async () => {
    await setup();
    await settle(() => state("Ao vivo"));
    const area = document.querySelector("[data-terminal-area]") as HTMLElement;
    expect(area).not.toBeNull();
    // The page's body is not the scrolling viewport the other pages use.
    expect(area.closest("[data-slot='scroll-area-viewport']")).toBeNull();
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
    void server.stop();
    await settle(() => state("Desanexado"));
    expect(state("Desanexado")).not.toBeNull();
    expect(button("Reabrir")).not.toBeNull();
  });

  test("Esc in the right-click menu closes the menu and the page never sees the key", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    x.select("trecho");
    const area = document.querySelector("[data-terminal-area]") as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(area, { clientX: 40, clientY: 50 });
    });
    const menu = screen.queryByRole("menu", { name: "Terminal" });
    expect(menu).not.toBeNull();
    // null: the key was stopped before it reached the page, so SplitView cannot read it.
    expect(await escapeReachesPageUnhandled(menu as HTMLElement)).toBeNull();
    expect(screen.queryByRole("menu", { name: "Terminal" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
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

  test("Ctrl+= and Ctrl+wheel zoom the terminal through the font setting that Settings shows (issue #476)", async () => {
    const { x, store } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.ctrlKey("="));
    await settle(() => x.terminal.options.fontSize === 14);
    expect(x.terminal.options.fontSize).toBe(14);
    act(() => void x.ctrlWheel(100));
    await settle(() => x.terminal.options.fontSize === 13);
    expect([store.terminalFont.value, x.terminal.options.fontSize]).toEqual([13, 13]);
  });

  test("pasting several lines into a program without bracketed paste asks first; Cancelar keeps them out (issue #476)", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    const clipboard = navigator.clipboard as unknown as { readText?: () => Promise<string> };
    const saved = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { ...clipboard, readText: async () => "rm a\nrm b" },
    });
    try {
      await act(async () => void x.chord("V"));
      await settle(() => screen.queryByRole("alertdialog") !== null);
      expect(screen.queryByRole("alertdialog", { name: "Colar 2 linhas?" })).not.toBeNull();
      await click("Cancelar");
      expect(x.pasted).toEqual([]);
      await act(async () => void x.chord("V"));
      await settle(() => screen.queryByRole("alertdialog") !== null);
      await click("Colar");
      await settle(() => x.pasted.length > 0);
    } finally {
      if (saved) Object.defineProperty(navigator, "clipboard", saved);
    }
    expect([x.pasted, screen.queryByRole("alertdialog") === null]).toEqual([["rm a\nrm b"], true]);
  });

  test("screen reader support turns on xterm's screen reader mode; while it is off the terminal says where it is (issue #476)", async () => {
    const { x, store } = await setup();
    await settle(() => state("Ao vivo"));
    const area = () => document.querySelector<HTMLElement>("[data-terminal-area]");
    const description = () =>
      document.getElementById(area()?.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
    expect(description()).toContain("Suporte a leitor de tela no terminal");
    act(() => store.terminalReader.set(true));
    await settle(() => x.terminal.options.screenReaderMode === true);
    expect([x.terminal.options.screenReaderMode, area()?.hasAttribute("aria-describedby")]).toEqual(
      [true, false],
    );
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

  test("a resync from the host attaches again", async () => {
    const { x, ptys } = await setup();
    await settle(() => state("Ao vivo"));
    const resets = () => x.drawn.filter((entry) => entry === "<reset>").length;
    const before = resets();
    // The fake xterm never says it drew, so the host holds back after 512 KB (FLOW_HIGH_BYTES); what
    // it keeps for this slow client passes 1 MB (QUEUE_LIMIT_BYTES), and the host asks the app to attach again.
    ptys.spawned[0]?.emit("a".repeat(600 * 1024));
    await settle(() => x.drawn.length > before + 1);
    ptys.spawned[0]?.emit("b".repeat(1200 * 1024));
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
    const d = await setup(true);
    await settle(() => state("Ao vivo"));
    await hookSession(d, "L1");
    // The app did learn the session: only the refused list keeps the button away.
    expect(d.store.getState().externals[`${d.hostId}/c1`]?.launchId).toBe("L1");
    expect(state("Ao vivo")).not.toBeNull();
    expect(button("Ver como sessão")).toBeNull();
  });

  test("a terminal opened by Claude aqui offers Ver como sessão, which shows the session of its launch", async () => {
    const d = await setup(false, true, "L1");
    await settle(() => state("Ao vivo"));
    expect(button("Ver como sessão")).toBeNull();
    await hookSession(d, "L1");
    await waitFor(() => button("Ver como sessão"), "the button of the launch's session");
    await click("Ver como sessão");
    expect(d.store.router.current).toEqual({
      name: "external",
      host: d.hostId,
      claudeSessionId: "c1",
    });
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

  // Issue #2608: the right-click menu is a menu: items, arrow keys, and the focus back on the terminal.
  async function openMenu(x: Awaited<ReturnType<typeof setup>>["x"], selected: boolean) {
    await settle(() => state("Ao vivo"));
    if (selected) x.select("trecho");
    const area = document.querySelector("[data-terminal-area]") as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(area, { clientX: 40, clientY: 50 });
    });
    return screen.queryByRole("menu", { name: "Terminal" }) as HTMLElement;
  }
  const focusedItem = () => document.activeElement?.textContent ?? "";
  const pressInMenu = (menu: HTMLElement, key: string) =>
    act(async () => {
      fireEvent.keyDown(document.activeElement ?? menu, { key });
    });

  test("the menu's three items are menu items, and Copiar is disabled with nothing selected", async () => {
    const { x } = await setup();
    await openMenu(x, false);
    const items = screen.queryAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Copiar", "Colar", "Selecionar tudo"]);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    expect(focusedItem()).toBe("Colar");
  });

  test("Down and Up move between the enabled items and wrap; Home and End go to the ends", async () => {
    const { x } = await setup();
    const menu = await openMenu(x, true);
    expect(focusedItem()).toBe("Copiar");
    const path: string[] = [];
    for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]) {
      await pressInMenu(menu, key);
      path.push(focusedItem());
    }
    expect(path).toEqual([
      "Colar",
      "Selecionar tudo",
      "Copiar",
      "Selecionar tudo",
      "Selecionar tudo",
      "Copiar",
    ]);
  });

  test("a disabled Copiar is skipped by the arrow keys", async () => {
    const { x } = await setup();
    const menu = await openMenu(x, false);
    const path: string[] = [];
    for (const key of ["ArrowUp", "ArrowDown", "Home"]) {
      await pressInMenu(menu, key);
      path.push(focusedItem());
    }
    expect(path).toEqual(["Selecionar tudo", "Colar", "Colar"]);
  });

  test("Esc closes the menu and gives the focus back to the terminal", async () => {
    const { x } = await setup();
    const menu = await openMenu(x, true);
    const before = x.focuses();
    await pressInMenu(menu, "Escape");
    expect([
      screen.queryByRole("menu", { name: "Terminal" }) === null,
      x.focuses() - before,
    ]).toEqual([true, 1]);
  });

  test("a click outside closes the menu and gives the focus back to the terminal", async () => {
    const { x } = await setup();
    await openMenu(x, true);
    const before = x.focuses();
    await act(async () => {
      fireEvent.click(document.body);
    });
    expect([
      screen.queryByRole("menu", { name: "Terminal" }) === null,
      x.focuses() - before,
    ]).toEqual([true, 1]);
  });

  test("Up with the focus off the items goes to the last one, as Down goes to the first", async () => {
    const { x } = await setup();
    const menu = await openMenu(x, true);
    act(() => menu.focus());
    await pressInMenu(menu, "ArrowUp");
    expect(focusedItem()).toBe("Selecionar tudo");
    act(() => menu.focus());
    await pressInMenu(menu, "ArrowDown");
    expect(focusedItem()).toBe("Copiar");
  });

  test("the Esc that closes the menu goes no further: the terminal under it never gets the key", async () => {
    const { x } = await setup();
    await openMenu(x, true);
    const area = document.querySelector("[data-terminal-area]") as HTMLElement;
    let reached = 0;
    const count = () => void reached++;
    area.addEventListener("keydown", count);
    await act(async () => {
      fireEvent.keyDown(area, { key: "Escape" });
    });
    area.removeEventListener("keydown", count);
    expect(reached).toBe(0);
  });

  test("Esc closes the menu and is marked handled even when the focus has left it", async () => {
    const { x } = await setup();
    await openMenu(x, true);
    act(() => (document.activeElement as HTMLElement).blur());
    const before = x.focuses();
    let notMarked = true;
    await act(async () => {
      notMarked = fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect([
      screen.queryByRole("menu", { name: "Terminal" }) === null,
      notMarked,
      x.focuses() - before,
    ]).toEqual([true, false, 1]);
  });

  test("a click on another control closes the menu and leaves the focus on that control", async () => {
    const { x } = await setup();
    await openMenu(x, true);
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    const before = x.focuses();
    await act(async () => {
      fireEvent.click(other);
    });
    const kept = document.activeElement === other;
    other.remove();
    expect([
      screen.queryByRole("menu", { name: "Terminal" }) === null,
      kept,
      x.focuses() - before,
    ]).toEqual([true, true, 0]);
  });

  test("a link in the output opens in the browser, http and https only", async () => {
    const { x, platform } = await setup();
    await settle(() => state("Ao vivo"));
    const opened: string[] = [];
    platform.openExternal = async (url) => void opened.push(url);
    x.clickLink("https://example.com/a");
    x.clickLink("file:///etc/passwd");
    expect(opened).toEqual(["https://example.com/a"]);
  });

  test("a path in the output, on a host of this computer, shows the file in its folder: never opened (issue #476)", async () => {
    const { x, platform, project } = await setup(false, false);
    await settle(() => state("Ao vivo"));
    const shown: string[] = [];
    const opened: string[] = [];
    platform.openPath = async (path: string) => void opened.push(path);
    platform.revealPath = async (path: string) => void shown.push(path);
    x.showLines("Edited src/app.ts:4");
    let clicked = false;
    await act(async () => {
      clicked = await x.clickPath(1);
    });
    await settle(() => shown.length > 0);
    expect([clicked, shown, opened]).toEqual([true, [join(project, "src", "app.ts")], []]);
  });

  test("a path on a host of another computer is copied, taken from the terminal's folder (issue #476)", async () => {
    const { x, copied, project } = await setup(false, false);
    await settle(() => state("Ao vivo"));
    x.showLines("", "wrote /var/log/out.log and ./notes/b.md");
    await act(async () => {
      await x.clickPath(2);
    });
    await settle(() => copied.length > 0);
    expect(copied).toEqual(["/var/log/out.log"]);
    x.showLines("./notes/b.md");
    await act(async () => {
      await x.clickPath(1);
    });
    await settle(() => copied.length > 1);
    expect(copied).toEqual(["/var/log/out.log", join(project, "notes", "b.md")]);
  });

  test("a path:line in the terminal's folder opens in the Files viewer at that line, and Fechar closes it (#506)", async () => {
    const { x, platform, project } = await setup();
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "app.ts"), "one\ntwo\nthree\n");
    await settle(() => state("Ao vivo"));
    const shown: string[] = [];
    platform.revealPath = async (path: string) => void shown.push(path);
    x.showLines("Edited src/app.ts:2");
    await act(async () => {
      await x.clickPath(1);
    });
    const atLine = () => document.querySelector(".cm-activeLine")?.textContent === "two";
    await settle(atLine);
    const viewer = () => screen.queryByRole("region", { name: "Arquivo src/app.ts" }) !== null;
    expect([viewer(), atLine(), shown]).toEqual([true, true, []]);
    await click("Fechar");
    expect(viewer()).toBe(false);
  });

  test("a path outside the terminal's folder is still copied, not opened in the viewer (#506)", async () => {
    const { x, copied } = await setup();
    await settle(() => state("Ao vivo"));
    x.showLines("wrote /var/log/out.log");
    await act(async () => {
      await x.clickPath(1);
    });
    await settle(() => copied.length > 0);
    const viewer = document.querySelector("[data-slot='terminal-file']") !== null;
    expect([copied, viewer]).toEqual([["/var/log/out.log"], false]);
  });

  test("a click anywhere else closes the right button's menu", async () => {
    await setup();
    await settle(() => state("Ao vivo"));
    const area = document.querySelector("[data-terminal-area]") as HTMLElement | null;
    await act(async () => {
      if (area) fireEvent.contextMenu(area, { clientX: 10, clientY: 10 });
    });
    expect(screen.queryByRole("menu", { name: "Terminal" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(document.body);
    });
    expect(screen.queryByRole("menu", { name: "Terminal" })).toBeNull();
  });

  test("Colar in the right button's menu pastes the clipboard", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    const area = document.querySelector("[data-terminal-area]") as HTMLElement | null;
    const saved = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "do menu" },
    });
    try {
      await act(async () => {
        if (area) fireEvent.contextMenu(area, { clientX: 10, clientY: 10 });
      });
      await click("Colar");
      await act(async () => {
        await Bun.sleep(5);
      });
    } finally {
      if (saved) Object.defineProperty(navigator, "clipboard", saved);
    }
    expect(x.pasted).toEqual(["do menu"]);
  });

  test("the menu has Selecionar tudo, and Copiar is off while nothing is selected", async () => {
    const { x, copied } = await setup();
    await settle(() => state("Ao vivo"));
    const area = document.querySelector("[data-terminal-area]") as HTMLElement;
    await act(async () => {
      fireEvent.contextMenu(area, { clientX: 5, clientY: 5 });
    });
    expect((button("Copiar") as HTMLButtonElement).disabled).toBe(true);
    await click("Selecionar tudo");
    expect(x.selectedAll()).toBe(1);
    expect(screen.queryByRole("menu", { name: "Terminal" })).toBeNull();
    x.select("trecho");
    await act(async () => {
      fireEvent.contextMenu(area, { clientX: 5, clientY: 5 });
    });
    expect((button("Copiar") as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(button("Copiar"));
    await click("Copiar");
    expect(copied).toEqual(["trecho"]);
  });
});
