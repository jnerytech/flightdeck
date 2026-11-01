import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const { realXtermDeps } = await import("../src/lib/xterm-deps.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

describe("terminal-ui: the route and the settings", () => {
  test("the terminal route opens the screen of the host's terminal", async () => {
    const d = makeDaemon(cleanups, { terminals: true });
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
    await waitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"));
    const { terminalId } = await store.terminalHost(hostId).open(d.project, 80, 24);
    render(<App store={store} />);
    await act(async () => {
      store.router.push({ name: "terminal", host: hostId, terminalId });
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Terminal" })).not.toBeNull());
    await waitFor(() => expect(screen.queryByText("Ao vivo")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Fechar terminal" })).not.toBeNull();
  });

  test("Configurações has the terminal's font size, kept in the store", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    });
    const field = screen.queryByLabelText(
      "Tamanho da fonte do terminal",
    ) as HTMLInputElement | null;
    expect(field).not.toBeNull();
    expect(field?.value).toBe("13");
    await act(async () => {
      if (field) fireEvent.change(field, { target: { value: "17" } });
    });
    expect(store.terminalFont.value).toBe(17);
  });

  test("the real xterm deps build a terminal with its addons", () => {
    const terminal = realXtermDeps.terminal({ cols: 80, rows: 24, allowProposedApi: true });
    for (const addon of [
      realXtermDeps.fit(),
      realXtermDeps.webLinks(() => {}),
      realXtermDeps.search(),
      realXtermDeps.unicode11(),
    ]) {
      terminal.loadAddon(addon);
    }
    expect([terminal.cols, terminal.rows]).toEqual([80, 24]);
    terminal.dispose();
  });

  test("the stylesheet takes xterm's own, which hides its helper textarea and measure element", () => {
    const desktop = resolve(import.meta.dir, "..");
    const css = readFileSync(resolve(desktop, "src/styles.css"), "utf8");
    const imported = /@import\s+"(@xterm\/xterm\/css\/xterm\.css)"/.exec(css)?.[1] ?? "";
    expect(imported).toBe("@xterm/xterm/css/xterm.css");
    expect(existsSync(resolve(desktop, "node_modules", imported))).toBe(true);
  });

  test("the real links addon hands a clicked link to the app", () => {
    const opened: string[] = [];
    const addon = realXtermDeps.webLinks((uri) => opened.push(uri)) as {
      _handler(event: MouseEvent, uri: string): void;
    };
    addon._handler(new MouseEvent("click"), "https://example.com");
    expect(opened).toEqual(["https://example.com"]);
  });
});
