import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, AUTO_UPDATE_KEY } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
/** Whether `check` comes true within the wait, read inside act so the screen keeps drawing. */
const seen = (check: () => boolean) =>
  settle(check).then(
    () => true,
    () => false,
  );
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A platform whose updater finds `available` and records what it was asked to do. */
function setup(
  lang: "en" | "pt-BR",
  opts: {
    available?: string | null;
    downloadError?: string;
    installError?: string;
    auto?: "false";
  } = {},
) {
  const mem = memoryPlatform(false, lang);
  if (opts.auto) mem.items.set(AUTO_UPDATE_KEY, opts.auto);
  const calls: string[] = [];
  mem.platform.updater = {
    supported: true,
    check: async () => {
      calls.push("check");
      return opts.available ? { version: opts.available, notes: "" } : null;
    },
    download: async () => {
      calls.push("download");
      if (opts.downloadError) throw new Error(opts.downloadError);
    },
    install: async () => {
      calls.push("install");
    },
    installDownloaded: async () => {
      calls.push("installDownloaded");
      if (opts.installError) throw new Error(opts.installError);
    },
  };
  // Issue #402: the tray's Quit, heard by the app, and the exit it then asks for.
  const quit: { ask: (() => void) | null } = { ask: null };
  mem.platform.onQuitRequested = (handler) => {
    quit.ask = handler;
    return () => {
      quit.ask = null;
    };
  };
  mem.platform.quitNow = async () => {
    calls.push("quitNow");
  };
  return { ...mem, calls, quit };
}

async function start(mem: ReturnType<typeof setup>) {
  const store = new AppStore(mem.platform);
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  // The App runs init() itself on mount; the screen settles before the test reads it.
  await uiIdle();
  return store;
}

/** The update card's words (issue #490), written out so a missing key cannot pass. */
const CARD = {
  en: {
    title: "Update available",
    ready: "Flightdeck v9.9.0 is ready.",
    safe: "Your sessions will not be interrupted.",
    notes: "Release notes",
    update: "Update",
    close: "Close the update notice",
  },
  "pt-BR": {
    title: "Atualização disponível",
    ready: "O Flightdeck v9.9.0 está pronto.",
    safe: "Suas sessões não serão interrompidas.",
    notes: "Notas da versão",
    update: "Atualizar",
    close: "Fechar o aviso de atualização",
  },
} as const;

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`app-autoupdate (${lang}): the app updates itself, on by default (issue #280)`, () => {
    // Issue #490: once ready, a card in the corner (Orca's) replaces the banner.
    test("a newer version is downloaded in the background, and once ready a card in the corner offers Update", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      await start(mem);
      const words = CARD[lang];
      const card = () => screen.queryByRole("region", { name: words.title });
      expect(await seen(() => card() !== null && mem.calls.includes("download"))).toBe(true);
      expect(mem.calls).toEqual(["check", "download"]);
      expect(card()?.textContent ?? "").toContain(words.ready);
      expect(card()?.textContent ?? "").toContain(words.safe);
      expect(card()?.getAttribute("data-slot")).toBe("update-card");
      // The banner no longer says the ready state.
      expect(screen.queryByRole("region", { name: dict.update.label })).toBeNull();
      const update = within(card() as HTMLElement).queryByRole("button", { name: words.update });
      expect(update).not.toBeNull();
      await act(async () => {
        fireEvent.click(update as HTMLElement);
      });
      expect(await seen(() => mem.calls.includes("install"))).toBe(true);
      expect(mem.calls).toEqual(["check", "download", "install"]);
    });

    test("the card's Release notes open the version's release page", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      const opened: string[] = [];
      mem.platform.openExternal = async (url: string) => void opened.push(url);
      await start(mem);
      const words = CARD[lang];
      const card = () => screen.queryByRole("region", { name: words.title });
      expect(await seen(() => card() !== null)).toBe(true);
      const notes = within(card() as HTMLElement).queryByRole("link", { name: words.notes });
      expect(notes).not.toBeNull();
      await act(async () => {
        fireEvent.click(notes as HTMLElement);
      });
      expect(opened).toEqual(["https://github.com/jnerytech/flightdeck/releases/tag/v9.9.0"]);
    });

    test("the card's close button puts it away until the next check", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      await start(mem);
      const words = CARD[lang];
      const card = () => screen.queryByRole("region", { name: words.title });
      expect(await seen(() => card() !== null)).toBe(true);
      const close = within(card() as HTMLElement).queryByRole("button", { name: words.close });
      expect(close).not.toBeNull();
      await act(async () => {
        fireEvent.click(close as HTMLElement);
      });
      expect(card() === null).toBe(true);
    });

    test("Quit with a downloaded update installs it on the way out, then exits (#402)", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      await start(mem);
      expect(await seen(() => mem.calls.includes("download"))).toBe(true);
      await act(async () => {
        mem.quit.ask?.();
      });
      expect(await seen(() => mem.calls.includes("quitNow"))).toBe(true);
      expect(mem.calls).toEqual(["check", "download", "installDownloaded", "quitNow"]);
    });

    test("a second Quit while the first installs does not install twice (#402)", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      await start(mem);
      expect(await seen(() => mem.calls.includes("download"))).toBe(true);
      await act(async () => {
        mem.quit.ask?.();
        mem.quit.ask?.();
      });
      expect(await seen(() => mem.calls.includes("quitNow"))).toBe(true);
      expect(mem.calls.filter((c) => c === "installDownloaded")).toEqual(["installDownloaded"]);
    });

    test("Quit with nothing downloaded exits at once, and a failed install still exits (#402)", async () => {
      const none = setup(lang, { available: null });
      await start(none);
      await act(async () => {
        none.quit.ask?.();
      });
      expect(await seen(() => none.calls.includes("quitNow"))).toBe(true);
      expect(none.calls).toEqual(["check", "quitNow"]);
      cleanup();
      const broken = setup(lang, { available: "9.9.0", installError: "locked" });
      await start(broken);
      expect(await seen(() => broken.calls.includes("download"))).toBe(true);
      await act(async () => {
        broken.quit.ask?.();
      });
      expect(await seen(() => broken.calls.includes("quitNow"))).toBe(true);
    });

    test("a check that finds the same version again does not download it twice", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      const store = await start(mem);
      expect(await seen(() => mem.calls.includes("download"))).toBe(true);
      await act(() => store.checkAppUpdate());
      expect(mem.calls).toEqual(["check", "download", "check"]);
    });

    test("a download that fails says why and offers nothing to restart into", async () => {
      const mem = setup(lang, { available: "9.9.0", downloadError: "bad signature" });
      await start(mem);
      expect(await seen(() => (document.body.textContent ?? "").includes("bad signature"))).toBe(
        true,
      );
      expect(screen.queryByRole("button", { name: dict.update.restartNow })).toBeNull();
    });

    test("turned off, nothing downloads: the banner offers Install as before", async () => {
      const mem = setup(lang, { available: "9.9.0", auto: "false" });
      await start(mem);
      expect(
        await seen(() => screen.queryByRole("button", { name: dict.update.install }) !== null),
      ).toBe(true);
      expect(mem.calls).toEqual(["check"]);
    });

    test("Settings has Update automatically, on by default, and turning it off is kept", async () => {
      const mem = setup(lang, { available: null });
      const store = await start(mem);
      await act(async () => {
        store.router.push({ name: "settings", section: "updates" });
      });
      expect(
        await seen(() => screen.queryByRole("checkbox", { name: dict.prefs.autoUpdate }) !== null),
      ).toBe(true);
      const box = screen.queryByRole("checkbox", {
        name: dict.prefs.autoUpdate,
      }) as HTMLInputElement;
      expect(box.checked).toBe(true);
      await act(async () => {
        fireEvent.click(box);
      });
      expect(mem.items.get(AUTO_UPDATE_KEY)).toBe("false");
    });
  });
}
