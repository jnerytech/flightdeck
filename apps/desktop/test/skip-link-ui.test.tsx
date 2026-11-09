import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppShell } = await import("../src/components/layout/app-shell.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const fn of cleanups.splice(0)) fn();
});

/**
 * #1430 (round 10 of #168): the sidebar put the page's content 27 Tab stops away. The shell's
 * first Tab stop skips to the content (WCAG 2.4.1).
 */
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]";
/** The first element Tab reaches: the first focusable one in document order, not taken out. */
const firstStop = () =>
  [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
    (el) => el.getAttribute("tabindex") !== "-1",
  ) ?? null;

describe("skip-link-ui: the first Tab stop skips to the content (#1430)", () => {
  test("the shell's first stop is the skip link, and it moves the focus to the content", async () => {
    render(
      <AppShell
        header={<button type="button">Menu</button>}
        sidebar={() => <button type="button">Project</button>}
        labels={{ sidebar: "Side", collapse: "Collapse", expand: "Expand", skip: "Skip" }}
      >
        <p>content</p>
      </AppShell>,
    );
    const link = screen.queryByRole("link", { name: "Skip" });
    const first = firstStop();
    await act(async () => {
      if (link) fireEvent.click(link);
    });
    const main = document.querySelector("main");
    expect([link !== null, first === link, document.activeElement === main]).toEqual([
      true,
      true,
      true,
    ]);
  });

  for (const [lang, name] of [
    ["en", "Skip to content"],
    ["pt-BR", "Pular para o conteúdo"],
  ] as const) {
    test(`in the app (${lang}), "${name}" is the first Tab stop`, async () => {
      const mem = memoryPlatform(false, lang);
      seedDemoHosts(mem.win.localStorage, mem.tokens, [
        { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
      ]);
      const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
      cleanups.push(() => store.dispose());
      render(<App store={store} />);
      const link = screen.queryByRole("link", { name });
      expect([link !== null, firstStop() === link]).toEqual([true, true]);
    });
  }
});
