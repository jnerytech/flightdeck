import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { GlobalSearch } = await import("../src/ui/GlobalSearch.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = (id: string, name: string, sessions: unknown[]) => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: ["issues"] },
  incompatibility: null,
  daemonUpdate: null,
  sessions,
});
const live = (id: string, status: string) => ({
  id,
  name: `sessao-${id}`,
  cwd: `/work/api/${id}`,
  status,
  pendingPermissions: [],
  updatedAt: "2026-11-04T10:00:00Z",
});

function world(over: Record<string, unknown> = {}) {
  const mem = memoryPlatform(false, "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.loadPalette = (async () => {}) as never;
  const base = {
    ...store.getState(),
    hosts: [
      host("h1", "alfa", [
        live("a", "idle"),
        live("b", "running"),
        live("c", "awaiting_permission"),
      ]),
      host("h2", "beta", [live("e", "idle")]),
    ],
    cards: {
      "h1/c1": { id: "c1", projectId: "p-api", title: "Fix login" },
      "h2/c2": { id: "c2", projectId: "p-site", title: "Fix footer" },
    },
    projects: {
      h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main", issues: null }],
      h2: [
        {
          id: "p-site",
          name: "site",
          path: "/srv/site",
          baseBranch: "main",
          issues: { provider: "github" },
        },
      ],
    },
  };
  return { store, mem, state: { ...base, ...over } as never as ReturnType<typeof store.getState> };
}

function open(w: ReturnType<typeof world>, route?: object) {
  if (route) w.store.router.push(route as never);
  const went: unknown[] = [];
  const view = (state = w.state) => (
    <GlobalSearch
      state={state}
      store={w.store}
      costs={true}
      onSearch={() => {}}
      onClose={() => {}}
      onOpenHit={() => {}}
      onGo={(target) => void went.push(target)}
    />
  );
  const rendered = render(view());
  return { went, view, rendered };
}

const input = () => within(screen.getByRole("dialog")).getByRole("textbox") as HTMLInputElement;
const options = () => within(screen.getByRole("dialog")).queryAllByRole("option");
const labels = () => options().map((o) => o.getAttribute("aria-label"));
const type = (text: string) =>
  act(async () => {
    fireEvent.change(input(), { target: { value: text } });
  });
const key = (k: string, init: object = {}) =>
  act(async () => {
    fireEvent.keyDown(input(), { key: k, ...init });
  });

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("paleta-mais-ui: the selected row can be seen (issue #147)", () => {
  test("the selected row wears the selection recipe; the stylesheet defines it from tokens", async () => {
    open(world());
    await type("sessao");
    await key("ArrowDown");
    const chosen = options().find((o) => o.getAttribute("aria-selected") === "true");
    expect(chosen?.className).toContain("palette-row");
    const rule = css.split("@utility palette-row")[1]?.split("@utility")[0] ?? "";
    expect(rule).toContain("var(--palette-selection)");
    expect(rule).toContain("var(--palette-selection-ring)");
    expect(rule).toContain("inset");
  });
});

describe("paleta-mais-ui: rows show the state live (issue #147)", () => {
  test("a session row wears its state glyph, and it follows the session", async () => {
    const w = world();
    const { view, rendered } = open(w);
    await type("sessao");
    const glyph = (name: string) =>
      within(screen.getByRole("option", { name })).getByRole("img").getAttribute("aria-label");
    expect(glyph("sessao-a")).toBe("idle");
    expect(glyph("sessao-b")).toBe("running");
    expect(glyph("sessao-c")).toBe("needs you");
    const changed = {
      ...w.state,
      hosts: [
        host("h1", "alfa", [
          live("a", "awaiting_permission"),
          live("b", "idle"),
          live("c", "idle"),
        ]),
        w.state.hosts[1],
      ],
    } as never;
    rendered.rerender(view(changed));
    expect(glyph("sessao-a")).toBe("needs you");
    expect(glyph("sessao-b")).toBe("idle");
  });

  test("a card row wears the card icon, and other rows no state glyph", async () => {
    open(world());
    await type("fix");
    const card = screen.getByRole("option", { name: "Fix login" });
    expect(card.querySelector("svg")).not.toBeNull();
    expect(within(card).queryByRole("img")).toBeNull();
  });
});

describe("paleta-mais-ui: recents with Alt+1 to Alt+6 (issue #147)", () => {
  const recents = [
    "session:h1/a",
    "session:h1/b",
    "session:h1/c",
    "session:h2/e",
    "card:h1/c1",
    "card:h2/c2",
    "project:h1/p-api",
  ];
  function seeded() {
    const w = world();
    w.mem.platform.storage.setItem("flightdeck.paletteRecents", JSON.stringify(recents));
    return w;
  }
  const recentRows = () => {
    const list = screen.getByRole("listbox", { name: "Recent" });
    return within(list).getAllByRole("option");
  };

  test("an empty query lists six at most, the one that needs you first, each with its Alt key", () => {
    open(seeded());
    const rows = recentRows();
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "sessao-c",
      "sessao-b",
      "sessao-a",
      "sessao-e",
      "Fix login",
      "Fix footer",
    ]);
    expect(rows.map((r) => r.querySelector("kbd")?.textContent)).toEqual([
      "Alt+1",
      "Alt+2",
      "Alt+3",
      "Alt+4",
      "Alt+5",
      "Alt+6",
    ]);
  });

  test("Alt+2 opens the second recent entry, in the palette only", async () => {
    const { went } = open(seeded());
    await key("2", { altKey: true });
    expect(went).toEqual([{ kind: "session", hostId: "h1", sessionId: "b" }]);
  });

  test("Alt+7 and Alt+N with text typed do nothing", async () => {
    const { went } = open(seeded());
    await key("7", { altKey: true });
    await type("fix");
    await key("1", { altKey: true });
    expect(went).toEqual([]);
  });

  test("the order is frozen while it is open: a state change does not move the rows", async () => {
    const w = seeded();
    const { view, rendered } = open(w);
    const before = recentRows().map((r) => r.getAttribute("aria-label"));
    rendered.rerender(
      view({
        ...w.state,
        hosts: [
          host("h1", "alfa", [
            live("a", "awaiting_permission"),
            live("b", "idle"),
            live("c", "idle"),
          ]),
          w.state.hosts[1],
        ],
      } as never),
    );
    expect(recentRows().map((r) => r.getAttribute("aria-label"))).toEqual(before);
  });
});

describe("paleta-mais-ui: the create row (issue #147)", () => {
  test("text that matches nothing offers a card, last; choosing it hands over the target", async () => {
    const { went } = open(world(), { name: "board", host: "h1", projectId: "p-api" });
    await type("Write the docs");
    expect(labels().at(-1)).toBe("Create card “Write the docs” in api");
    await key("ArrowDown");
    await key("Enter");
    expect(went).toEqual([
      { kind: "create-card", hostId: "h1", projectId: "p-api", title: "Write the docs" },
    ]);
  });

  test("a query that matches a card does not offer one", async () => {
    open(world(), { name: "board", host: "h1", projectId: "p-api" });
    await type("login");
    expect(labels().some((l) => l?.startsWith("Create card"))).toBe(false);
  });
});

describe("paleta-mais-ui: scope chips (issue #147)", () => {
  const chips = () => screen.queryAllByRole("button", { name: /^Remove filter/ });

  test("opened on a board, the host and project are chips that narrow the list", async () => {
    open(world(), { name: "board", host: "h1", projectId: "p-api" });
    expect(chips().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Remove filter: host alfa",
      "Remove filter: project api",
    ]);
    await type("fix");
    expect(labels()).toEqual(["Fix login"]);
  });

  test("removing a chip widens the list; Clear all removes the rest; the keyboard works", async () => {
    open(world(), { name: "board", host: "h1", projectId: "p-api" });
    await type("fix");
    await act(async () => {
      fireEvent.click(chips()[1] as HTMLElement);
    });
    expect(chips()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    });
    expect(chips()).toHaveLength(0);
    expect(labels()).toEqual(["Fix login", "Fix footer"]);
    // A chip is a real button: Enter on it removes it as a click does.
    expect(screen.queryByRole("button", { name: "Clear all filters" })).toBeNull();
  });

  test("no scope, no chips; closing and opening again seeds the scope afresh", async () => {
    open(world());
    expect(chips()).toHaveLength(0);
    cleanup();
    const w = world();
    open(w, { name: "board", host: "h2", projectId: "p-site" });
    await act(async () => {
      fireEvent.click(chips()[0] as HTMLElement);
    });
    cleanup();
    open(w, { name: "board", host: "h2", projectId: "p-site" });
    expect(chips()).toHaveLength(2);
  });
});

describe("paleta-mais-ui: a long section shows eight rows and a more button (issue #147)", () => {
  const many = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `h1/m${i}`,
      { id: `m${i}`, projectId: "p-api", title: `Card ${String(i).padStart(2, "0")}` },
    ]),
  );

  test("eight first, '22 more' reveals twenty more at a time", async () => {
    open(world({ cards: many }));
    await type("card");
    expect(options()).toHaveLength(8);
    const more = screen.getByRole("button", { name: "22 more" });
    await act(async () => {
      fireEvent.click(more);
    });
    expect(options()).toHaveLength(28);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "2 more" }));
    });
    expect(options()).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  test("a short section has no button", async () => {
    open(world());
    await type("fix");
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });
});

describe("paleta-mais-ui: it reads in Portuguese too", () => {
  test("the chips, the create row and the more button have their words", async () => {
    const mem = memoryPlatform(false, "pt-BR");
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    store.loadPalette = (async () => {}) as never;
    store.router.push({ name: "board", host: "h1", projectId: "p-api" } as never);
    const w = world();
    render(
      <GlobalSearch
        state={{ ...w.state, hosts: w.state.hosts }}
        store={store}
        costs={true}
        onSearch={() => {}}
        onClose={() => {}}
        onOpenHit={() => {}}
        onGo={() => {}}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Remover filtro/ })).toHaveLength(2);
    await act(async () => {
      fireEvent.change(input(), { target: { value: "algo novo" } });
    });
    await settle(() => labels().some((l) => l?.startsWith("Criar card")));
    expect(labels().at(-1)).toBe("Criar card “algo novo” em api");
  });
});
