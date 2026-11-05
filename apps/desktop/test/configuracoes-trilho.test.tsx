import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { Settings } = await import("../src/ui/Settings.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(updater = true) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const settings = { ...store.getState().settings, updaterSupported: updater };
  render(
    <Settings
      store={store}
      settings={settings}
      onCloseToTray={() => {}}
      onAutostart={() => {}}
      onGlobalShortcut={() => {}}
      appUpdate={{ upToDate: false } as never}
      onCheckUpdate={() => {}}
      onNotifyUpdates={() => {}}
      theme="system"
      onTheme={() => {}}
      density="comfortable"
      onDensity={() => {}}
      lang="pt-BR"
      onLang={() => {}}
      t={store.i18n.t}
    />,
  );
}

const rail = () => screen.getByRole("navigation", { name: "Seções das configurações" });
const items = () =>
  within(rail())
    .queryAllByRole("button")
    .map((b) => b.textContent);

describe("configuracoes-trilho: the rail and the search", () => {
  test("a rail lists the sections, one button each, in the order of the page", () => {
    setup();
    expect(items()).toEqual([
      "Aparência",
      "Clientes",
      "Janela",
      "Atualizações",
      "Atalho global",
      "Assistente de IA",
      "Webhooks",
    ]);
  });

  test("a section the app cannot offer is not on the rail", () => {
    setup(false);
    expect(items()).not.toContain("Atualizações");
  });

  test("a rail button takes you to its section: it scrolls there and the focus follows", async () => {
    setup();
    const scrolled: string[] = [];
    // On HTMLElement.prototype, where other test files in the same process also put theirs: a stub
    // on Element.prototype would sit behind it. Put the previous one back afterwards.
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("aria-label") ?? "");
    };
    try {
      await act(async () => {
        fireEvent.click(within(rail()).getByRole("button", { name: "Janela" }));
      });
    } finally {
      proto.scrollIntoView = before;
    }
    expect(scrolled).toEqual(["Janela"]);
    const section = screen.getByRole("region", { name: "Janela" });
    expect(document.activeElement).toBe(section);
    expect(
      within(rail()).getByRole("button", { name: "Janela" }).getAttribute("aria-current"),
    ).toBe("true");
  });

  test("the search keeps the sections that match, by name or by the settings inside", async () => {
    setup();
    const search = screen.getByRole("searchbox", { name: "Buscar nas configurações" });
    await act(async () => {
      fireEvent.change(search, { target: { value: "tema" } });
    });
    expect(items()).toEqual(["Aparência"]);
    expect(screen.queryByRole("region", { name: "Janela" })).toBeNull();
    expect(screen.queryByLabelText("Tema")).not.toBeNull();
    await act(async () => {
      fireEvent.change(search, { target: { value: "bandeja" } });
    });
    expect(items()).toEqual(["Janela"]);
    await act(async () => {
      fireEvent.change(search, { target: { value: "zzz" } });
    });
    expect(items()).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("Nenhuma configuração corresponde.");
    await act(async () => {
      fireEvent.change(search, { target: { value: "" } });
    });
    expect(items()).toHaveLength(7);
  });
});
