import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppShell } = await import("../src/components/layout/app-shell.tsx");
const { TopBarHost } = await import("../src/components/shell/top-bar.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { memoryPlatform, TOKEN } = await import("./fixtures.ts");

const settle = waiter(4000);
const cleanups: Array<() => void> = [];

/** happy-dom evaluates media queries against its viewport and fires `change` on resize. */
async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  await settle(() => window.matchMedia("(width < 1024px)").matches === width < 1024);
  await settle(() => window.matchMedia("(width < 640px)").matches === width < 640);
  await act(async () => {});
}

afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0)) fn();
  await viewport(1024);
});

const initialOf = () => document.querySelector("[data-slot='top-bar-host-initial']");

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);

  describe(`top bar by width (${lang}): the switcher's initial and the history buttons (issue #641)`, () => {
    test("the switcher carries the host's initial for the narrow bar, hidden from a reader because the button is named", () => {
      render(
        <TopBarHost
          hosts={[{ id: "a", name: "alfa", status: "online" }]}
          currentId="a"
          t={t}
          onChoose={() => {}}
          onAdd={() => {}}
        />,
      );
      expect(initialOf()?.textContent).toBe("A");
      expect(initialOf()?.getAttribute("aria-hidden")).toBe("true");
      cleanup();
      render(<TopBarHost hosts={[]} currentId={null} t={t} onChoose={() => {}} onAdd={() => {}} />);
      expect(initialOf() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    });

    test("the drawer opens with the shell's drawerTop above the sidebar, and a wide window never draws it", async () => {
      const shell = (
        <AppShell
          header={<span>Flightdeck</span>}
          sidebar={() => <p>hosts</p>}
          drawerTop={<p>history</p>}
          labels={{ sidebar: "Side", collapse: "Collapse", expand: "Expand" }}
        >
          <p>content</p>
        </AppShell>
      );
      render(shell);
      expect(screen.queryByText("history") === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
      await viewport(500);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Expand" }));
      });
      const drawer = screen.queryByRole("dialog", { name: "Side" });
      expect(within(drawer as HTMLElement).queryByText("history")).not.toBeNull();
      expect(within(drawer as HTMLElement).queryByText("hosts")).not.toBeNull();
    });

    test("in the app, back and forward sit in the top bar, and below 640 px move into the drawer", async () => {
      const store = new AppStore(memoryPlatform(false, lang).platform, {
        baseDelayMs: 60_000,
        wakeDebounceMs: 0,
      });
      cleanups.push(() => store.dispose());
      render(<App store={store} />);
      await act(() => store.addHost({ name: "alfa", url: "ws://127.0.0.1:1/v1/ws", token: TOKEN }));
      const bar = () => within(screen.getByRole("banner"));
      expect(bar().queryByRole("button", { name: dict.nav.back })).not.toBeNull();
      expect(bar().queryByRole("button", { name: dict.nav.forward })).not.toBeNull();

      await viewport(800);
      expect(bar().queryByRole("button", { name: dict.nav.back })).not.toBeNull();

      await viewport(500);
      expect(bar().queryByRole("button", { name: dict.nav.back }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
      expect(bar().queryByRole("button", { name: dict.nav.forward }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
      await act(async () => {
        fireEvent.click(bar().getByRole("button", { name: dict.shell.expand }));
      });
      const drawer = within(screen.getByRole("dialog", { name: dict.shell.sidebar }));
      expect(drawer.queryByRole("button", { name: dict.nav.back })).not.toBeNull();
      expect(drawer.queryByRole("button", { name: dict.nav.forward })).not.toBeNull();
    });
  });
}

// #1069: on the first run the switcher reads "no host". At 17 characters the pt-BR label filled the
// switcher's 10rem cap and left the crumbs' fixed slot (crumb-largura) too little: the bar read
// "Nenhum host ain… · H… › Adicionar h…" at 1280. As long as the English one, it fits.
describe("top bar with no host (#1069): the switcher's label is as short as the English one", () => {
  for (const [lang, label] of [
    ["en", "No host yet"],
    ["pt-BR", "Nenhum host"],
  ] as const) {
    test(`${lang}: the switcher reads and is named "${label}"`, () => {
      render(
        <TopBarHost
          hosts={[]}
          currentId={null}
          t={translator(lang)}
          onChoose={() => {}}
          onAdd={() => {}}
        />,
      );
      const name = document.querySelector(".top-bar-host-name")?.textContent;
      expect([name, screen.queryByRole("button", { name: label }) !== null]).toEqual([label, true]);
    });
  }
});
