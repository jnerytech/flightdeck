import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentFiles } = await import("../../src/features/agentcfg/agent-files.tsx");
const { AgentContext } = await import("../../src/features/agentcfg/agent-context.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #3986: the CLAUDE.md list puts the project's file first and never repeats a title; the Context tab shows short paths and a plain footer. */
const claudemd = (path: string, origin: "project" | "user") => ({
  kind: "claudemd",
  path,
  origin,
  readOnly: origin === "user",
  hash: "h",
});

/** What the daemon lists: in code-unit order, so the worktrees' copies come before CLAUDE.md. */
const LISTED = [
  claudemd(".flightdeck/worktrees/a/CLAUDE.md", "project"),
  claudemd(".flightdeck/worktrees/b/CLAUDE.md", "project"),
  claudemd("CLAUDE.md", "project"),
  claudemd("CLAUDE.md", "user"),
];

const MEMORY = {
  limitLines: 200,
  limitBytes: 25 * 1024,
  indexLines: 2,
  indexBytes: 80,
  loadedLines: 2,
  loadedBytes: 80,
  cutBy: null,
  leftOutLines: [],
  leftOutFiles: [],
};

const source = (kind: string, path: string) => ({
  kind,
  path,
  bytes: 40,
  tokens: 10,
  load: "start",
});

const BUDGET = {
  root: "/work/app",
  home: "/home/me",
  startTokens: 40,
  sources: [
    source("project", "/work/app/CLAUDE.md"),
    source("rules", "/work/app/.claude/rules/geral.md"),
    source("user", "/home/me/.claude/CLAUDE.md"),
    source("project", "/work/CLAUDE.md"),
  ],
  memory: MEMORY,
};

async function store(lang: Lang, budget: unknown = BUDGET) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  s.hostCommand = (async (_host: string, type: string) => {
    if (type === "agentcfg.list") return { items: LISTED };
    if (type === "memory.budget") return budget;
    return null;
  }) as never;
  return s;
}

describe("the CLAUDE.md list", () => {
  test("the project's own file is first, and no two rows read the same", async () => {
    const s = await store("en");
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentFiles store={s} hostId="h1" projectId="p1" kind="claudemd" />
      </TContext.Provider>,
    );
    const rows = () =>
      [...document.querySelectorAll("ul li button")].map(
        (b) => b.querySelector("span")?.textContent,
      );
    await settle(() => rows().length === 4);
    expect(rows()).toEqual([
      "CLAUDE.md",
      ".flightdeck/worktrees/a/CLAUDE.md",
      ".flightdeck/worktrees/b/CLAUDE.md",
      "~/.claude/CLAUDE.md",
    ]);
  });
});

describe.each([
  {
    lang: "en",
    uncut: "All 2 lines of MEMORY.md are loaded (under 1 KB of 25 KB).",
    cut: "200 of 340 lines of MEMORY.md are loaded (7 KB of 25 KB).",
  },
  {
    lang: "pt-BR",
    uncut: "Todas as 2 linhas do MEMORY.md são carregadas (menos de 1 KB de 25 KB).",
    cut: "200 de 340 linhas do MEMORY.md são carregadas (7 KB de 25 KB).",
  },
] as const)("the Context tab (%#)", ({ lang, uncut, cut }) => {
  const open = async (budget: unknown) => {
    const s = await store(lang, budget);
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentContext store={s} hostId="h1" projectId="p1" />
      </TContext.Provider>,
    );
    await settle(() => document.querySelector("section li") !== null);
  };

  test("a source in the project shows relative to it, one under the home shows with ~, the rest as sent", async () => {
    await open(BUDGET);
    const titles = [...document.querySelectorAll("section li")].map(
      (li) => li.querySelector(".break-all")?.textContent,
    );
    expect(titles).toEqual([
      "CLAUDE.md",
      ".claude/rules/geral.md",
      "~/.claude/CLAUDE.md",
      "/work/CLAUDE.md",
    ]);
  });

  test("a budget with no root or home (an older daemon) shows the paths as sent", async () => {
    await open({ ...BUDGET, root: undefined, home: undefined });
    expect(screen.queryByText("/work/app/CLAUDE.md")).not.toBeNull();
  });

  test("the footer says in plain words how much of MEMORY.md is loaded", async () => {
    await open(BUDGET);
    expect(screen.queryByText(uncut)).not.toBeNull();
  });

  test("a cut index says how many of its lines are loaded", async () => {
    await open({
      ...BUDGET,
      memory: {
        ...MEMORY,
        indexLines: 340,
        loadedLines: 200,
        loadedBytes: 7 * 1024,
        cutBy: "lines",
        leftOutLines: ["- late"],
      },
    });
    expect(screen.queryByText(cut)).not.toBeNull();
  });
});
