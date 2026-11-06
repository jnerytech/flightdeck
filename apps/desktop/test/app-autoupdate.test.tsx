import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

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
  opts: { available?: string | null; downloadError?: string; auto?: "false" } = {},
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
  };
  return { ...mem, calls };
}

async function start(mem: ReturnType<typeof setup>) {
  const store = new AppStore(mem.platform);
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  // The App runs init() itself on mount.
  await act(async () => {
    await Bun.sleep(0);
  });
  return store;
}

const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`app-autoupdate (${lang}): the app updates itself, on by default (issue #280)`, () => {
    test("a newer version is downloaded in the background, and once ready the banner offers Restart now", async () => {
      const mem = setup(lang, { available: "9.9.0" });
      await start(mem);
      const banner = () => screen.queryByRole("region", { name: dict.update.label });
      expect(await seen(() => banner() !== null && mem.calls.includes("download"))).toBe(true);
      expect(mem.calls).toEqual(["check", "download"]);
      expect(banner()?.textContent ?? "").toContain(fill(dict.update.ready, { version: "9.9.0" }));
      const restart = within(banner() as HTMLElement).queryByRole("button", {
        name: dict.update.restartNow,
      });
      expect(restart).not.toBeNull();
      await act(async () => {
        fireEvent.click(restart as HTMLElement);
      });
      expect(await seen(() => mem.calls.includes("install"))).toBe(true);
      expect(mem.calls).toEqual(["check", "download", "install"]);
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
