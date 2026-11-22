import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { Settings } = await import("../../src/features/settings/page.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(language: "en" | "pt-BR") {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const settings = { ...store.getState().settings, updaterSupported: true };
  render(
    <Settings
      store={store}
      settings={settings}
      onCloseToTray={() => {}}
      onAutostart={() => {}}
      onGlobalShortcut={() => {}}
      onShortcuts={() => {}}
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
    />,
  );
}

const WORDS = {
  en: {
    rail: "Settings sections",
    search: "Search settings",
    appearance: "Appearance",
    window: "Window",
    notifications: "Notifications",
    shortcut: "Global shortcut",
    group: "Preview features",
    setup: "Show the setup checklist",
    teleport: "Preview: move a session to another host",
    // What a person types, and the section that holds the control it names.
    typed: [
      ["cache", "Appearance"],
      ["tab order", "Appearance"],
      ["reader", "Appearance"],
      ["volume", "Notifications"],
      ["file", "Notifications"],
      ["setup", "Window"],
      ["teleport", "Window"],
      ["preview features", "Window"],
      ["shortcuts", "Global shortcut"],
    ],
  },
  "pt-BR": {
    rail: "Seções das configurações",
    search: "Buscar nas configurações",
    appearance: "Aparência",
    window: "Janela",
    notifications: "Notificações",
    shortcut: "Atalho global",
    group: "Recursos em prévia",
    setup: "Mostrar a lista de configuração inicial",
    teleport: "Prévia: mover uma sessão para outro host",
    typed: [
      ["cache", "Aparência"],
      ["ordem", "Aparência"],
      ["leitor", "Aparência"],
      ["volume", "Notificações"],
      ["arquivo", "Notificações"],
      ["configuração inicial", "Janela"],
      ["teleport", "Janela"],
      ["recursos em prévia", "Janela"],
      ["atalhos", "Atalho global"],
    ],
  },
} as const;

describe.each(["en", "pt-BR"] as const)("settings search words (%s)", (language) => {
  const w = WORDS[language];
  const rail = () => screen.getByRole("navigation", { name: w.rail });
  const items = () =>
    within(rail())
      .queryAllByRole("button")
      .map((b) => b.textContent);
  const typeInSearch = (text: string) =>
    act(async () => {
      fireEvent.change(screen.getByRole("searchbox", { name: w.search }), {
        target: { value: text },
      });
    });

  test.each(WORDS[language].typed as ReadonlyArray<readonly [string, string]>)(
    "typing %p keeps the section %p, which holds a control with that name (#4008)",
    async (typed, section) => {
      setup(language);
      await typeInSearch(typed);
      expect(items()).toContain(section);
    },
  );

  test("the teleport preview sits in a Preview features group at the end of the Window panel, after the setup checklist (#4008)", () => {
    setup(language);
    const panel = screen.getByRole("region", { name: w.window });
    const group = within(panel).queryByRole("group", { name: w.group });
    expect(group).not.toBeNull();
    expect(
      within(group as HTMLElement).queryByRole("checkbox", { name: w.teleport }),
    ).not.toBeNull();
    // The setup checklist stays in the panel itself, before the group.
    expect(within(group as HTMLElement).queryByRole("checkbox", { name: w.setup })).toBeNull();
    const setupBox = within(panel).getByRole("checkbox", { name: w.setup });
    const after = setupBox.compareDocumentPosition(group as HTMLElement);
    expect((after & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    const boxes = within(panel).getAllByRole("checkbox");
    // The group closes the panel: the last checkbox of the panel is the one inside it.
    expect((group as HTMLElement).contains(boxes.at(-1) ?? null)).toBe(true);
  });
});
