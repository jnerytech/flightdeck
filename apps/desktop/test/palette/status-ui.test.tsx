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
    hint: "Enter searches the history.",
    placeholder: "Sessions, cards, projects, actions…",
    historyNone: "Nothing in the history matches “x”.",
  },
  "pt-BR": {
    input: "Buscar no histórico",
    none: "Nada corresponde a “zzzz”. Pressione Enter para buscar no histórico.",
    found: (n: number) => `Resultados: ${n}`,
    searching: "alfa: buscando…",
    hint: "Enter busca no histórico.",
    placeholder: "Sessões, cards, projetos, ações…",
    historyNone: "Nada no histórico corresponde a “x”.",
  },
} as const;

/** The palette with one online host that has one session; `history` puts a history search in the state. */
type Search = { query: string; hits: unknown[]; waiting: string[]; silent: string[] };
const SEARCHING: Search = { query: "x", hits: [], waiting: ["h1"], silent: [] };
const NO_HIT: Search = { query: "x", hits: [], waiting: [], silent: [] };

function open(lang: "en" | "pt-BR", history?: Search) {
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
    search: history ?? base.search,
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

  test("the hint that Enter searches the history stays under the field, and the field names it", async () => {
    open(lang);
    const field = screen.queryByLabelText(WORDS[lang].input) as HTMLInputElement;
    const hintOf = () => {
      const id = field?.getAttribute("aria-describedby") ?? "";
      return id ? (document.getElementById(id)?.textContent ?? "") : "";
    };
    const empty = hintOf();
    await type(lang, "alfa");
    expect({
      empty: empty === WORDS[lang].hint,
      typed: hintOf() === WORDS[lang].hint,
      placeholder: field.placeholder === WORDS[lang].placeholder,
    }).toEqual({ empty: true, typed: true, placeholder: true });
  });

  test("a finished history search with no hit says so in the status region", () => {
    open(lang, NO_HIT);
    expect(status()?.textContent === WORDS[lang].historyNone).toBe(true);
  });

  test("text typed after a history search is judged on its own: no stale history line, and its no-match line shows", async () => {
    open(lang, NO_HIT);
    await type(lang, "zzzz");
    expect({
      says: status()?.textContent === WORDS[lang].none,
      seen: status() !== null && !status()?.classList.contains("sr-only"),
    }).toEqual({ says: true, seen: true });
  });

  test("a history search that found nothing says it in sight, and not while a host stayed silent", async () => {
    const said = WORDS[lang].historyNone.replace("“x”", "“alfa”");
    open(lang, { ...NO_HIT, query: "alfa" });
    await type(lang, "alfa");
    const first = {
      says: status()?.textContent === said,
      seen: status() !== null && !status()?.classList.contains("sr-only"),
    };
    cleanup();
    open(lang, { ...NO_HIT, query: "alfa", silent: ["h1"] });
    await type(lang, "alfa");
    expect({ ...first, notWhenSilent: status()?.textContent !== said }).toEqual({
      says: true,
      seen: true,
      notWhenSilent: true,
    });
  });

  test("the host still searching the history is said in a status region of its own", () => {
    open(lang, SEARCHING);
    expect(screen.queryByText(WORDS[lang].searching)?.closest("output") != null).toBe(true);
  });
});
