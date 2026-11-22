import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { GlobalSearch } = await import("../../src/features/palette/ui.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const WORDS = {
  en: {
    input: "Search the history",
    none: "Nothing matches “zzzz”. Press Enter to search the history.",
    found: (n: number) => `Results: ${n}`,
    searching: "alfa: searching…",
  },
  "pt-BR": {
    input: "Buscar no histórico",
    none: "Nada corresponde a “zzzz”. Pressione Enter para buscar no histórico.",
    found: (n: number) => `Resultados: ${n}`,
    searching: "alfa: buscando…",
  },
} as const;

/** The palette with one online host that has one session; `waiting` puts a history search in flight. */
function open(lang: "en" | "pt-BR", waiting = false) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.palette.load = (async () => {}) as never;
  store.palette.recents = () => [];
  const base = store.getState();
  const state = {
    ...base,
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: { daemonVersion: "x", features: ["issues"] },
        incompatibility: null,
        daemonUpdate: null,
        sessions: [
          {
            id: "a",
            name: "api",
            cwd: "/work/api",
            status: "idle",
            pendingPermissions: [],
            updatedAt: "2026-11-04T10:00:00Z",
          },
        ],
      },
    ],
    projects: {},
    search: waiting ? { query: "x", hits: [], waiting: ["h1"], silent: [] } : base.search,
  } as never as ReturnType<typeof store.getState>;
  render(
    <GlobalSearch
      state={state}
      store={store}
      costs={true}
      onSearch={() => {}}
      onClose={() => {}}
      onOpenHit={() => {}}
      onGo={() => {}}
    />,
  );
}

const status = () =>
  screen.queryByRole("dialog")?.querySelector<HTMLElement>('[data-slot="palette-status"]') ?? null;
const type = async (lang: "en" | "pt-BR", text: string) => {
  const field = screen.queryByLabelText(WORDS[lang].input) as HTMLInputElement;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field, { target: { value: text } });
  });
};

describe.each(["en", "pt-BR"] as const)("palette status (%s)", (lang) => {
  test("a query that matches nothing says so, in sight, and where to go next", async () => {
    open(lang);
    await type(lang, "zzzz");
    expect({
      says: status()?.textContent === WORDS[lang].none,
      seen: status() !== null && !status()?.classList.contains("sr-only"),
    }).toEqual({ says: true, seen: true });
  });

  test("a query with matches announces how many rows it left, out of sight", async () => {
    open(lang);
    await type(lang, "alfa");
    const rows = screen.queryByRole("dialog")?.querySelectorAll('[role="option"]').length ?? 0;
    expect({
      rows: rows > 0,
      says: status()?.textContent === WORDS[lang].found(rows),
      hidden: status()?.classList.contains("sr-only") ?? false,
    }).toEqual({ rows: true, says: true, hidden: true });
  });

  test("an empty field announces nothing", () => {
    open(lang);
    expect({ there: status() !== null, text: status()?.textContent }).toEqual({
      there: true,
      text: "",
    });
  });

  test("the host still searching the history is said in the same region", () => {
    open(lang, true);
    expect(status()?.textContent?.includes(WORDS[lang].searching)).toBe(true);
  });
});
