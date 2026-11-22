import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentFiles } = await import("../../src/features/agentcfg/agent-files.tsx");
const { AgentMcp } = await import("../../src/features/agentcfg/agent-mcp.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #4082: a long name with no break point wraps inside its row, and an empty Files tab announces no list. */
const WORDS = {
  en: { list: "Files", empty: "No skills in this project." },
  "pt-BR": { list: "Arquivos", empty: "Nenhuma skill neste projeto." },
} as const;

const LONG_SERVER = `a-very-long-server-name-${"without-any-break-point-".repeat(2)}so-it-cannot-wrap`;
const LONG_PATH = `${"deep/worktree/".repeat(8)}CLAUDE.md`;
/** The class that lets a word with no space break where the row ends. */
const WRAP = "[overflow-wrap:anywhere]";

async function store(lang: Lang, answer: (type: string) => unknown) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  s.hostCommand = (async (_host: string, type: string) => answer(type)) as never;
  return s;
}

/** The element that carries the name: the one with the medium weight among those with this text. */
const nameElement = (text: string) =>
  screen.queryAllByText(text).find((el) => el.className.includes("font-medium")) ?? null;

describe.each(["en", "pt-BR"] as const)("agent config, long names (%s)", (lang) => {
  test("an MCP server's long name wraps inside its row", async () => {
    const s = await store(lang, (type) =>
      type === "mcp.list"
        ? {
            servers: [
              {
                name: LONG_SERVER,
                command: "node",
                origin: "project",
                readOnly: false,
                transport: "stdio",
                enabled: true,
              },
            ],
          }
        : null,
    );
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentMcp store={s} hostId="h1" projectId="p1" />
      </TContext.Provider>,
    );
    await settle(() => nameElement(LONG_SERVER) !== null);
    expect(nameElement(LONG_SERVER)?.className).toContain(WRAP);
  });

  test("a CLAUDE.md titled by a long path wraps inside its row", async () => {
    const s = await store(lang, (type) =>
      type === "agentcfg.list"
        ? {
            items: [
              { kind: "claudemd", path: LONG_PATH, origin: "project", readOnly: false, hash: "h" },
            ],
          }
        : null,
    );
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentFiles store={s} hostId="h1" projectId="p1" kind="claudemd" />
      </TContext.Provider>,
    );
    await settle(() => nameElement(LONG_PATH) !== null);
    expect(nameElement(LONG_PATH)?.className).toContain(WRAP);
  });

  test("with no files only the empty state shows, and with one the list does", async () => {
    const w = WORDS[lang];
    const none = await store(lang, (type) => (type === "agentcfg.list" ? { items: [] } : null));
    render(
      <TContext.Provider value={none.i18n.t}>
        <AgentFiles store={none} hostId="h1" projectId="p1" kind="skill" />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByText(w.empty) !== null);
    expect(screen.queryByRole("list", { name: w.list })).toBeNull();
    await act(async () => cleanup());
    const one = await store(lang, (type) =>
      type === "agentcfg.list"
        ? {
            items: [
              {
                kind: "skill",
                path: ".claude/skills/a/SKILL.md",
                origin: "project",
                readOnly: false,
                hash: "h",
                name: "a",
              },
            ],
          }
        : null,
    );
    render(
      <TContext.Provider value={one.i18n.t}>
        <AgentFiles store={one} hostId="h1" projectId="p1" kind="skill" />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByRole("list", { name: w.list }) !== null);
    expect(screen.queryByText(w.empty)).toBeNull();
  });
});
