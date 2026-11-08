import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TopBarActions, TopBarHost } = await import("../src/components/shell/top-bar.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { memoryPlatform, TOKEN } = await import("./fixtures.ts");
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const fn of cleanups.splice(0)) fn();
});

const HOSTS = [
  { id: "a", name: "alfa", status: "online" as const },
  { id: "b", name: "beta", status: "offline" as const },
];

/** A Radix menu opens on pointer down. */
async function open(button: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(button);
  });
}

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);
  const fill = (text: string, vars: Record<string, string>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

  describe(`top bar (${lang}): the host, search, theme and version across the window (issue #282)`, () => {
    test("the switcher names the current host; its menu lists every host with its state, and choosing one selects it", async () => {
      const chosen: string[] = [];
      render(
        <TopBarHost
          hosts={HOSTS}
          currentId="a"
          t={t}
          onChoose={(id) => chosen.push(id)}
          onAdd={() => chosen.push("add")}
        />,
      );
      const button = screen.queryByRole("button", {
        name: fill(dict.shell.host, { host: "alfa" }),
      });
      expect(button).not.toBeNull();
      await open(button as HTMLElement);
      const offline = fill(dict.shell.hostItem, {
        host: "beta",
        state: dict.hosts.status.offline,
      });
      const beta = screen.queryByRole("menuitemradio", { name: offline });
      expect(beta).not.toBeNull();
      expect(
        screen
          .queryByRole("menuitemradio", {
            name: fill(dict.shell.hostItem, { host: "alfa", state: dict.hosts.status.online }),
          })
          ?.getAttribute("aria-checked"),
      ).toBe("true");
      await act(async () => {
        fireEvent.click(beta as HTMLElement);
      });
      expect(chosen).toEqual(["b"]);
    });

    test("each host in the menu shows its daemon's version, and one that differs from the app's is marked (#281)", async () => {
      render(
        <TopBarHost
          hosts={[
            { id: "a", name: "alfa", status: "online", version: "0.37.0" },
            { id: "b", name: "beta", status: "online", version: "0.36.4" },
          ]}
          currentId="a"
          appVersion="0.37.0"
          t={t}
          onChoose={() => undefined}
          onAdd={() => undefined}
        />,
      );
      await open(
        screen.queryByRole("button", {
          name: fill(dict.shell.host, { host: "alfa" }),
        }) as HTMLElement,
      );
      const online = dict.hosts.status.online;
      expect(
        screen.queryByRole("menuitemradio", {
          name: fill(dict.shell.hostItemVersion, {
            host: "alfa",
            state: online,
            version: "0.37.0",
          }),
        }),
      ).not.toBeNull();
      const beta = screen.queryByRole("menuitemradio", {
        name: fill(dict.shell.hostItemDiffers, {
          host: "beta",
          state: online,
          version: "0.36.4",
          app: "0.37.0",
        }),
      });
      expect(beta).not.toBeNull();
      expect(beta?.textContent ?? "").toContain("v0.36.4");
    });

    test("a host's connection in the menu stays a plain 8 px dot, not a session's glyph (#146)", async () => {
      render(
        <TopBarHost
          hosts={HOSTS}
          currentId="a"
          t={t}
          onChoose={() => undefined}
          onAdd={() => undefined}
        />,
      );
      await open(
        screen.queryByRole("button", {
          name: fill(dict.shell.host, { host: "alfa" }),
        }) as HTMLElement,
      );
      const item = screen.queryByRole("menuitemradio", { name: /^alfa, / }) as HTMLElement | null;
      expect(item).not.toBeNull();
      const dot = within(item as HTMLElement).queryByRole("img");
      expect(dot?.className.includes("size-2") ?? false).toBe(true);
      expect(dot?.querySelector("svg") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    });

    test("the menu adds a host too, and with no host the switcher says so", async () => {
      const chosen: string[] = [];
      render(
        <TopBarHost
          hosts={[]}
          currentId={null}
          t={t}
          onChoose={(id) => chosen.push(id)}
          onAdd={() => chosen.push("add")}
        />,
      );
      const button = screen.queryByRole("button", { name: dict.shell.noHost });
      expect(button).not.toBeNull();
      await open(button as HTMLElement);
      const add = screen.queryByRole("menuitem", { name: dict.sidebar.addHost });
      expect(add).not.toBeNull();
      await act(async () => {
        fireEvent.click(add as HTMLElement);
      });
      expect(chosen).toEqual(["add"]);
    });

    test("in the app, the bar sits across the window: its switcher selects a host, its search opens the palette", async () => {
      const store = new AppStore(memoryPlatform(false, lang).platform, {
        baseDelayMs: 60_000,
        wakeDebounceMs: 0,
      });
      cleanups.push(() => store.dispose());
      render(<App store={store} />);
      await act(() => store.addHost({ name: "alfa", url: "ws://127.0.0.1:1/v1/ws", token: TOKEN }));
      await act(() => store.addHost({ name: "beta", url: "ws://127.0.0.1:1/v1/ws", token: TOKEN }));
      const banner = screen.queryByRole("banner");
      expect(banner).not.toBeNull();
      const bar = within(banner as HTMLElement);
      const switcher = bar.queryByRole("button", { name: dict.shell.noHost });
      expect(switcher).not.toBeNull();
      await open(switcher as HTMLElement);
      const beta = screen.queryByRole("menuitemradio", { name: /^beta, / });
      expect(beta).not.toBeNull();
      await act(async () => {
        fireEvent.click(beta as HTMLElement);
      });
      expect(
        bar.queryByRole("button", { name: fill(dict.shell.host, { host: "beta" }) }),
      ).not.toBeNull();
      const search = bar.queryByRole("button", { name: dict.shell.searchLabel });
      expect(search).not.toBeNull();
      await act(async () => {
        fireEvent.click(search as HTMLElement);
      });
      expect(screen.queryByRole("dialog", { name: dict.searchUi.label })).not.toBeNull();
      await act(async () => {
        fireEvent.keyDown(
          screen.queryByRole("dialog", { name: dict.searchUi.label }) as HTMLElement,
          {
            key: "Escape",
          },
        );
      });
      // The theme button switches the theme and then names the way back.
      const toDark = bar.queryByRole("button", { name: dict.shell.toDark });
      expect(toDark).not.toBeNull();
      await act(async () => {
        fireEvent.click(toDark as HTMLElement);
      });
      expect(bar.queryByRole("button", { name: dict.shell.toLight })).not.toBeNull();
      // Add a host, from the switcher's menu, opens the form.
      await open(
        bar.queryByRole("button", { name: fill(dict.shell.host, { host: "beta" }) }) as HTMLElement,
      );
      const add = screen.queryByRole("menuitem", { name: dict.sidebar.addHost });
      expect(add).not.toBeNull();
      await act(async () => {
        fireEvent.click(add as HTMLElement);
      });
      // The breadcrumb (and the tab) now say where the person is.
      expect(bar.queryAllByText(dict.sidebar.addHostCrumb).length > 0).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    });

    test("search opens the palette, the theme button says what it switches to, and the version shows", async () => {
      const did: string[] = [];
      const draw = (theme: "light" | "dark") => (
        <TopBarActions
          t={t}
          theme={theme}
          version="0.37.0"
          bell={<span>bell</span>}
          onSearch={() => did.push("search")}
          onToggleTheme={() => did.push("theme")}
        />
      );
      const { rerender } = render(draw("light"));
      const search = screen.queryByRole("button", { name: dict.shell.searchLabel });
      expect(search).not.toBeNull();
      expect(search?.textContent ?? "").toContain(dict.shell.search);
      const toDark = screen.queryByRole("button", { name: dict.shell.toDark });
      expect(toDark).not.toBeNull();
      await act(async () => {
        fireEvent.click(search as HTMLElement);
        fireEvent.click(toDark as HTMLElement);
      });
      expect(did).toEqual(["search", "theme"]);
      rerender(draw("dark"));
      expect(screen.queryByRole("button", { name: dict.shell.toLight })).not.toBeNull();
      expect(screen.queryByText("bell")).not.toBeNull();
      // Seen as "v0.37.0"; heard as the app and its version.
      expect(screen.queryByText("v0.37.0")).not.toBeNull();
      expect(screen.queryByText(fill(dict.shell.version, { version: "0.37.0" }))).not.toBeNull();
    });
  });
}
