import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentPage } = await import("../../src/features/agentcfg/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #3985: the subagents switch belongs to the Agents tab, the subtitle names the tabs the host has, and the MCP live line needs a status. */
const WORDS = {
  en: {
    switch: "Personas as subagents",
    agents: "Agents",
    tabs: "Agent configuration",
    mcp: "MCP",
    plain: "MCP, CLAUDE.md, agents and skills of this project.",
    withMemory: "MCP, CLAUDE.md, agents, skills, memory and context of this project.",
    live: "Live status from the session Carrinho.",
    connected: "Connected",
  },
  "pt-BR": {
    switch: "Personas como subagentes",
    agents: "Agentes",
    tabs: "Configuração do agente",
    mcp: "MCP",
    plain: "MCP, CLAUDE.md, agentes e skills deste projeto.",
    withMemory: "MCP, CLAUDE.md, agentes, skills, memória e contexto deste projeto.",
    live: "Status ao vivo da sessão Carrinho.",
    connected: "Conectado",
  },
} as const;

const SERVER = {
  name: "eco",
  command: "node",
  origin: "project",
  readOnly: false,
  transport: "stdio",
  enabled: true,
};

/** The Agent screen of a project that has a live session, on a host with the given features. */
async function screenOf(lang: Lang, features: string[], status: unknown[]) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online: true, features }]);
  const hidden = store as unknown as { state: Record<string, unknown> };
  const host = (hidden.state.hosts as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  host.sessions = [{ id: "s1", name: "Carrinho", status: "idle", cwd: "/repo" }];
  hidden.state = { ...hidden.state, projects: { h1: [{ id: "p1", path: "/repo", name: "repo" }] } };
  store.projectList.load = (async () => [{ id: "p1", personaSubagents: "all" }]) as never;
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "mcp.list") return { servers: [SERVER] };
    if (type === "mcp.status") return { servers: status };
    return null;
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <AgentPage store={store} hostId="h1" projectId="p1" projectName="repo" />
    </TContext.Provider>,
  );
  await act(async () => {});
  await settle(() => screen.queryByRole("listitem", { name: "eco" }) !== null);
}

describe.each(["en", "pt-BR"] as const)("the agent screen's tabs (%s)", (lang) => {
  const w = WORDS[lang];
  const open = async (name: string) => {
    const tab = screen.queryByRole("tab", { name }) as HTMLElement;
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0 });
    });
  };

  test("the subagents switch is not on the MCP tab, and shows on the Agents tab", async () => {
    await screenOf(lang, ["personas"], []);
    expect(screen.queryByLabelText(w.switch)).toBeNull();
    await open(w.agents);
    await settle(() => screen.queryByLabelText(w.switch) !== null);
    expect(screen.queryByLabelText(w.switch)).not.toBeNull();
  });

  test("a host without the personas feature has no switch on any tab", async () => {
    await screenOf(lang, [], []);
    await open(w.agents);
    expect(screen.queryByLabelText(w.switch)).toBeNull();
  });

  test("the subtitle names memory and context only on a host that has them", async () => {
    await screenOf(lang, ["memory"], []);
    expect(screen.queryByText(w.withMemory)).not.toBeNull();
    cleanup();
    await screenOf(lang, [], []);
    expect(screen.queryByText(w.plain)).not.toBeNull();
  });

  test("the tab strip wraps instead of running past a narrow window (#4278)", async () => {
    await screenOf(lang, ["memory"], []);
    const list = screen.queryByRole("tablist", { name: w.tabs });
    expect(list).not.toBeNull();
    expect(list?.className.split(" ").includes("tabs-wrap")).toBe(true);
  });

  test("the live line shows only when the session reported a status", async () => {
    await screenOf(lang, [], []);
    expect(screen.queryByText(w.live)).toBeNull();
    cleanup();
    await screenOf(lang, [], [{ name: "eco", status: "connected" }]);
    await settle(() => screen.queryByText(w.connected) !== null);
    expect(screen.queryByText(w.live)).not.toBeNull();
  });
});
