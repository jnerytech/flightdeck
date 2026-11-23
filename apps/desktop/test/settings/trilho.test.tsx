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

function setup(updater = true, logs = false) {
  const mem = memoryPlatform(false, "pt-BR");
  if (logs) {
    mem.platform.logs = { write: async () => {}, tail: async () => [], openFolder: async () => {} };
  }
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const settings = { ...store.getState().settings, updaterSupported: updater };
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
      "Notificações",
      "Atualizações",
      "Atalho global",
      "Assistente de IA",
      "Backup",
      "Webhooks",
    ]);
  });

  test("the diagnostics section is on the rail only where the app has a log file", () => {
    setup(true, true);
    expect(items()).toContain("Diagnóstico");
    cleanup();
    setup();
    expect(items()).not.toContain("Diagnóstico");
  });

  // #4438: a build that cannot update keeps the section and says so, instead of leaving a reader to guess.
  test("a build that cannot update keeps the Updates section, says so and draws no update control", async () => {
    setup(false);
    expect(items()).toContain("Atualizações");
    const section = screen.getByRole("region", { name: "Atualizações" });
    expect(
      within(section).queryByText("Este build não se atualiza sozinho.", { exact: false }),
    ).not.toBeNull();
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(within(section).queryAllByRole("checkbox")).toHaveLength(0);
    await act(async () => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Buscar nas configurações" }), {
        target: { value: "versão" },
      });
    });
    expect(items()).toEqual(["Atualizações"]);
  });

  test("a build that can update keeps its controls in the Updates section", () => {
    setup(true);
    const section = screen.getByRole("region", { name: "Atualizações" });
    expect(
      within(section).queryByRole("button", { name: "Procurar atualização agora" }),
    ).not.toBeNull();
    expect(
      within(section).queryByText("Este build não se atualiza sozinho.", { exact: false }),
    ).toBeNull();
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
    expect(items()).toHaveLength(9);
  });
});
