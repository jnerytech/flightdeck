import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../../src/demo/boot.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { Settings } = await import("../../src/features/settings/page.tsx");
const { validateShortcut } = await import("../../src/features/shortcuts/index.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const WORDS = {
  en: {
    region: "Global shortcut",
    field: "Key combination",
    example: /For example/,
    open: "Show the keyboard shortcuts",
    sheet: "Keyboard shortcuts",
    saved: "Shortcut saved: Ctrl+Alt+G",
    savedBack: "Shortcut saved: Ctrl+Alt+F",
  },
  "pt-BR": {
    region: "Atalho global",
    field: "Combinação de teclas",
    example: /Por exemplo/,
    open: "Mostrar os atalhos do teclado",
    sheet: "Atalhos de teclado",
    saved: "Atalho salvo: Ctrl+Alt+G",
    savedBack: "Atalho salvo: Ctrl+Alt+F",
  },
} as const;

function setup(language: "en" | "pt-BR", onShortcuts: () => void = () => {}) {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const screenFor = (globalShortcut: string) => (
    <Settings
      store={store}
      settings={{ ...store.getState().settings, updaterSupported: true, globalShortcut }}
      onCloseToTray={() => {}}
      onAutostart={() => {}}
      onGlobalShortcut={() => {}}
      onShortcuts={onShortcuts}
      appUpdate={{ upToDate: false } as never}
      onCheckUpdate={() => {}}
      onNotifyUpdates={() => {}}
      onAutoUpdate={() => {}}
      theme="system"
      onTheme={() => {}}
      density="comfortable"
      onDensity={() => {}}
      lang={language}
      onLang={() => {}}
      t={store.i18n.t}
    />
  );
  const view = render(screenFor(store.getState().settings.globalShortcut));
  // The saved key changes as it does when the OS takes a new one.
  return { saveAs: (key: string) => view.rerender(screenFor(key)) };
}

// Issue #4009: the field is named for what goes in it, shows an example and the page opens the list.
describe.each(["en", "pt-BR"] as const)("settings, global shortcut field (%s)", (language) => {
  const w = WORDS[language];
  const region = () => screen.getByRole("region", { name: w.region });

  test("the textbox has a name of its own, not the panel's title", () => {
    setup(language);
    expect(within(region()).queryByRole("textbox", { name: w.field })).not.toBeNull();
    expect(within(region()).queryByRole("textbox", { name: w.region })).toBeNull();
  });

  test("the help shows an example combination that the field accepts", () => {
    setup(language);
    const box = within(region()).queryByRole("textbox", { name: w.field });
    expect(box).not.toBeNull();
    const help = (box?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(help).toMatch(w.example);
    const combination = /(?:Ctrl|Alt|Shift|Super)(?:\+[A-Za-z0-9]+)+/.exec(
      help.replace(w.example, ""),
    );
    expect(combination).not.toBeNull();
    expect(validateShortcut(combination?.[0] ?? "").ok).toBe(true);
  });

  test("a saved shortcut is announced in the panel's status, and a first render says nothing (#4512)", () => {
    const { saveAs } = setup(language);
    const status = () =>
      within(region())
        .queryAllByRole("status")
        .map((item) => item.textContent);
    expect(status().includes(w.saved)).toBe(false);
    saveAs("Ctrl+Alt+G");
    expect(status().includes(w.saved)).toBe(true);
  });

  test("saving the first key again is announced too, not only a change from the opening key (#4512)", () => {
    const { saveAs } = setup(language);
    const status = () =>
      within(region())
        .queryAllByRole("status")
        .map((item) => item.textContent);
    saveAs("Ctrl+Alt+G");
    saveAs("Ctrl+Alt+F");
    expect(status().includes(w.savedBack)).toBe(true);
  });

  test("a button in the panel asks for the shortcut list", async () => {
    let asked = 0;
    setup(language, () => {
      asked++;
    });
    const open = within(region()).queryByRole("button", { name: w.open });
    expect(open).not.toBeNull();
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    expect(asked).toBe(1);
  });

  test("in the app, the button opens the sheet and closing it gives the focus back to the button", async () => {
    const mem = memoryPlatform(false, language);
    seedDemoHosts(mem.win.localStorage, mem.tokens, [
      { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
    ]);
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    render(<App store={store} />);
    await act(async () => {});
    await act(async () => {
      store.router.push({ name: "settings" });
    });
    const button = within(region()).queryByRole("button", { name: w.open }) as HTMLElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.focus();
      fireEvent.click(button);
    });
    expect(screen.queryByRole("dialog", { name: w.sheet })).not.toBeNull();
    await act(async () => void fireEvent.keyDown(document.body, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: w.sheet })).toBeNull();
    expect(document.activeElement === button).toBe(true); // NOSONAR: a boolean keeps a DOM node out of the failure diff
    store.dispose();
  });
});
