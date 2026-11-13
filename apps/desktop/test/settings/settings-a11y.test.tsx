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

function setup(autostartSupported = true) {
  const mem = memoryPlatform(false, "pt-BR");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const settings = { ...store.getState().settings, updaterSupported: true, autostartSupported };
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
const search = () => screen.getByRole("searchbox", { name: "Buscar nas configurações" });
const typeInSearch = (text: string) =>
  act(async () => {
    fireEvent.change(search(), { target: { value: text } });
  });

describe("settings page for a screen reader (#2598)", () => {
  test("the disabled autostart checkbox is tied to the reason it is disabled", () => {
    setup(false);
    const box = screen.getByLabelText("Iniciar com o Windows") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    const id = box.getAttribute("aria-describedby");
    expect(id).not.toBeNull();
    expect(document.getElementById(id as string)?.textContent).toBe(
      "indisponível nesta plataforma",
    );
  });

  test("an autostart checkbox that works has no reason to point at", () => {
    setup(true);
    const box = screen.getByLabelText("Iniciar com o Windows");
    expect(box.getAttribute("aria-describedby")).toBeNull();
  });

  test("the search says how many sections match, and the empty case still says none", async () => {
    setup();
    await typeInSearch("tema");
    expect(items()).toEqual(["Aparência"]);
    expect(screen.queryByRole("status")?.textContent).toBe("1 seção corresponde.");
    await typeInSearch("notific");
    expect(items()).toEqual(["Notificações", "Atualizações"]);
    expect(screen.queryByRole("status")?.textContent).toBe("2 seções correspondem.");
    await typeInSearch("zzz");
    expect(screen.queryByRole("status")?.textContent).toBe("Nenhuma configuração corresponde.");
    await typeInSearch("");
    expect(screen.queryByRole("status")?.textContent).toBe("");
  });
});

describe("the rail mark follows the page as it scrolls (#2598)", () => {
  type Entry = { target: Element; isIntersecting: boolean };
  const original = globalThis.IntersectionObserver;
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  /** A stand-in observer that records what is watched and lets a test report what is on screen. */
  function fakeObserver() {
    const seen: { callback: ((entries: Entry[]) => void) | null; watched: Element[] } = {
      callback: null,
      watched: [],
    };
    globalThis.IntersectionObserver = class {
      constructor(callback: (entries: Entry[]) => void) {
        seen.callback = callback;
      }
      observe(el: Element) {
        seen.watched.push(el);
      }
      unobserve() {}
      disconnect() {}
    } as never;
    return seen;
  }

  const marked = () =>
    within(rail())
      .queryAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "true")
      .map((b) => b.textContent);

  test("after a click and a scroll, only the section on screen is marked", async () => {
    const seen = fakeObserver();
    setup();
    await act(async () => {
      fireEvent.click(within(rail()).getByRole("button", { name: "Janela" }));
    });
    expect(marked()).toEqual(["Janela"]);
    const section = (name: string) => screen.getByRole("region", { name });
    expect(seen.watched).toContain(section("Atualizações"));
    await act(async () => {
      seen.callback?.([
        { target: section("Janela"), isIntersecting: false },
        { target: section("Atualizações"), isIntersecting: true },
      ]);
    });
    expect(marked()).toEqual(["Atualizações"]);
  });

  test("with two sections on screen the upper one is the mark", async () => {
    const seen = fakeObserver();
    setup();
    const section = (name: string) => screen.getByRole("region", { name });
    await act(async () => {
      seen.callback?.([
        { target: section("Atalho global"), isIntersecting: true },
        { target: section("Notificações"), isIntersecting: true },
      ]);
    });
    expect(marked()).toEqual(["Notificações"]);
  });
});
