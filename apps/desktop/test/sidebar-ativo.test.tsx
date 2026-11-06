import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const ALL = ["costs", "messaging", "teams", "plugins", "personas", "snippets", "ssh"];

function setup(
  features: string[] = ALL,
  platform = memoryPlatform(false, "en").platform,
  route?: import("../src/lib/router.ts").Route,
) {
  const store = new AppStore(platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features },
        sessions: [],
      },
    ],
  } as never as ReturnType<typeof store.getState>;
  const view = (collapsed = false) => (
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      t={store.i18n.t}
      go={() => {}}
      {...(route ? { route } : {})}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />
  );
  const opened: string[] = [];
  store.openLink = ((url: string) => {
    opened.push(url);
  }) as never;
  return { store, view, platform, opened };
}

type R = import("../src/lib/router.ts").Route;

/** Every destination of the bar and the route that opens it (SG-M1). */
const DESTINATIONS: Array<[string, R]> = [
  ["Costs", { name: "costs" }],
  ["History", { name: "history", host: "h1" }],
  ["Personas", { name: "personas" }],
  ["Snippets", { name: "snippets" }],
  ["Plugins", { name: "plugins" }],
  ["Vault", { name: "vault" } as R],
  ["SSH", { name: "connections" }],
  ["Settings", { name: "settings" }],
];

describe("sidebar-ativo: every destination of the bar is marked when its page is open (SG-M1)", () => {
  test("each item gets the accent bar and aria-current on its own page, and no other item does", () => {
    for (const [label, route] of DESTINATIONS) {
      const { view } = setup(ALL, undefined, route);
      const { unmount } = render(view());
      const marked = screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-current") === "page")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
      expect([label, marked.filter((name) => !name.startsWith("Open host"))]).toEqual([
        label,
        [label],
      ]);
      expect(screen.getByRole("button", { name: label }).className).toContain("nav-active");
      unmount();
    }
  });

  test("an item with a Beta or New badge says it in its description, and the group names read in pt-BR (SG-m2, SG-m9)", () => {
    const en = setup();
    const { unmount } = render(en.view());
    const described = (name: string) => {
      const button = screen.getByRole("button", { name });
      const ids = (button.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent).join(" ");
    };
    expect(described("Teams")).toBe("Beta");
    expect(described("Conversations")).toBe("New");
    expect(
      screen.getByRole("button", { name: "Board" }).getAttribute("aria-describedby"),
    ).toBeNull();
    unmount();
    const pt = setup(ALL, memoryPlatform(false, "pt-BR").platform);
    render(pt.view());
    for (const name of ["Trabalho", "Automação", "Observabilidade", "Biblioteca", "Máquinas"]) {
      expect(screen.getByRole("group", { name })).toBeTruthy();
    }
  });
});
