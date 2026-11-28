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
    noAnswer: "No host answered the history search for “zzzz”.",
    needsYou: "needs you",
    running: "running",
  },
  "pt-BR": {
    input: "Buscar no histórico",
    none: "Nada corresponde a “zzzz”. Pressione Enter para buscar no histórico.",
    found: (n: number) => `Resultados: ${n}`,
    searching: "alfa: buscando…",
    hint: "Enter busca no histórico.",
    placeholder: "Sessões, cards, projetos, ações…",
    historyNone: "Nada no histórico corresponde a “x”.",
    noAnswer: "Nenhum host respondeu à busca no histórico por “zzzz”.",
    needsYou: "precisa de você",
    running: "rodando",
  },
} as const;

/** The palette with one online host that has one session; `history` puts a history search in the state. */
type Search = { query: string; hits: unknown[]; waiting: string[]; silent: string[] };
const SEARCHING: Search = { query: "x", hits: [], waiting: ["h1"], silent: [] };
const NO_HIT: Search = { query: "x", hits: [], waiting: [], silent: [] };

type Options = {
  /** The statuses of the sessions of host alfa; one idle session `api` when absent. */
  sessions?: string[];
  /** A second online host, beta, with no session. */
  beta?: boolean;
};

function open(lang: "en" | "pt-BR", history?: Search, options: Options = {}) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.palette.load = (async () => {}) as never;
  store.palette.recents = () => [];
  const base = store.getState();
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
  const sessions = (options.sessions ?? ["idle"]).map((status, i) => ({
    id: `s${i}`,
    name: options.sessions ? `api${i}` : "api",
    cwd: options.sessions ? `/work/api${i}` : "/work/api",
    status,
    pendingPermissions: [],
    updatedAt: "2026-11-04T10:00:00Z",
  }));
  const state = {
    ...base,
    hosts: [host("h1", "alfa", sessions), ...(options.beta ? [host("h2", "beta", [])] : [])],
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
    expect(status()?.textContent).toBe(WORDS[lang].historyNone);
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

  test("the count of results includes the rows behind a more button, and a press of it keeps it (#4525)", async () => {
    open(lang, undefined, { sessions: Array.from({ length: 12 }, () => "idle") });
    await type(lang, "api");
    const shown = () => screen.queryByRole("dialog")?.querySelectorAll('[role="option"]').length;
    const before = { rows: shown(), says: status()?.textContent === WORDS[lang].found(12) };
    const more = screen.queryByRole("button", { name: lang === "en" ? "4 more" : "mais 4" });
    expect(more).not.toBeNull();
    await act(async () => {
      fireEvent.click(more as HTMLElement);
    });
    expect({ before, after: status()?.textContent === WORDS[lang].found(12) }).toEqual({
      before: { rows: 8, says: true },
      after: true,
    });
  });

  test("a session row's description says its state before its host and folder (#4526)", async () => {
    open(lang, undefined, { sessions: ["awaiting_permission", "running", "idle"] });
    await type(lang, "api");
    const described = (label: string) => {
      const row = screen.queryByRole("option", { name: label });
      const ids = (row?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    };
    expect({
      needs: described("api0").startsWith(`${WORDS[lang].needsYou} alfa`),
      running: described("api1").startsWith(`${WORDS[lang].running} alfa`),
      idle: described("api2").includes("alfa"),
    }).toEqual({ needs: true, running: true, idle: true });
  });

  test("a row with no state is described by its detail alone (#4526)", async () => {
    open(lang);
    await type(lang, "alfa");
    const host = screen.queryByRole("option", { name: "alfa" });
    const ids = (host?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect({ row: host !== null, ids: ids.map((id) => id.endsWith("-detail")) }).toEqual({
      row: true,
      ids: [true],
    });
  });

  test("a history search that no host answered says so in sight, not Results: 0 (#4527)", async () => {
    open(lang, { ...NO_HIT, query: "zzzz", silent: ["h1"] });
    await type(lang, "zzzz");
    expect({
      says: status()?.textContent === WORDS[lang].noAnswer,
      seen: status() !== null && !status()?.classList.contains("sr-only"),
    }).toEqual({ says: true, seen: true });
  });

  test("a silent host next to one that answered does not make the search a failure (#4527)", async () => {
    open(lang, { ...NO_HIT, query: "zzzz", silent: ["h1"] }, { beta: true });
    await type(lang, "zzzz");
    expect(status()?.textContent === WORDS[lang].found(0)).toBe(true);
  });

  test("rows that match locally do not hide that no host answered the search (#4527)", async () => {
    open(lang, { ...NO_HIT, query: "alfa", silent: ["h1"] });
    await type(lang, "alfa");
    expect({
      says: status()?.textContent === WORDS[lang].noAnswer.replace("zzzz", "alfa"),
      seen: status() !== null && !status()?.classList.contains("sr-only"),
    }).toEqual({ says: true, seen: true });
  });
});
