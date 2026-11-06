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

afterEach(() => cleanup());

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
