import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentFiles } = await import("../../src/features/agentcfg/agent-files.tsx");
const { AgentMcp } = await import("../../src/features/agentcfg/agent-mcp.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #3984: every field of the agent, skill and MCP forms has a visible label. Issue #3986: a disabled Save says why. */
const WORDS = {
  en: {
    agentName: "Agent name",
    newAgent: "New agent",
    name: "Name",
    description: "Description",
    tools: "Tools",
    model: "Model",
    edit: "Edit eco",
    editApi: "Edit api",
    mcpName: "Server name",
    transport: "Transport",
    command: "Command",
    args: "Arguments (one per line)",
    env: "Environment variables (NAME=value, one per line)",
    url: "URL",
    headers: "Headers (Name: value, one per line)",
    open: "revisor (From the project)",
    nothingChanged: "Nothing changed",
    needFields: "The name and the description are required.",
    save: "Save",
  },
  "pt-BR": {
    agentName: "Nome do agente",
    newAgent: "Novo agente",
    name: "Nome",
    description: "Descrição",
    tools: "Ferramentas",
    model: "Modelo",
    edit: "Editar eco",
    editApi: "Editar api",
    mcpName: "Nome do servidor",
    transport: "Transporte",
    command: "Comando",
    args: "Argumentos (um por linha)",
    env: "Variáveis de ambiente (NOME=valor, uma por linha)",
    url: "URL",
    headers: "Cabeçalhos (Nome: valor, um por linha)",
    open: "revisor (Do projeto)",
    nothingChanged: "Nada mudou",
    needFields: "O nome e a descrição são obrigatórios.",
    save: "Salvar",
  },
} as const;

const AGENT =
  "---\nname: revisor\ndescription: Revisa o diff\ntools: Read, Grep\nmodel: sonnet\n---\nCorpo.\n";
const ITEM = {
  kind: "agent",
  path: ".claude/agents/revisor.md",
  origin: "project",
  readOnly: false,
  hash: "h1",
  name: "revisor",
};

const SERVERS = [
  {
    name: "eco",
    origin: "project",
    readOnly: false,
    transport: "stdio",
    enabled: true,
    command: "node",
    args: ["a.js"],
  },
  {
    name: "api",
    origin: "project",
    readOnly: false,
    transport: "http",
    enabled: true,
    type: "http",
    url: "https://example.test/mcp",
  },
];

/** A store whose host answers the list and read of one agent file, and the MCP list. */
async function store(lang: Lang, content = AGENT) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  s.hostCommand = (async (_host: string, type: string) => {
    if (type === "agentcfg.list") return { items: [ITEM] };
    if (type === "agentcfg.read") return { content, hash: "h1" };
    if (type === "mcp.list") return { servers: SERVERS };
    return null;
  }) as never;
  return s;
}

const labels = () => [...document.querySelectorAll("label")].map((l) => l.textContent);
const press = (name: string) =>
  act(async () => {
    fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
  });

async function openAgent(lang: Lang, content?: string) {
  const s = await store(lang, content);
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentFiles store={s} hostId="h1" projectId="p1" kind="agent" />
    </TContext.Provider>,
  );
  const w = WORDS[lang];
  await settle(() => screen.queryByRole("button", { name: w.open }) !== null);
  await press(w.open);
  await settle(() => screen.queryByLabelText(w.model) !== null);
  return w;
}

describe.each(["en", "pt-BR"] as const)("agent files, labels and the Save reason (%s)", (lang) => {
  test("an agent's name, description, tools and model have visible labels", async () => {
    const w = await openAgent(lang);
    expect([w.name, w.description, w.tools, w.model].every((l) => labels().includes(l))).toBe(true);
  });

  test("a new agent's name field has a visible label", async () => {
    const s = await store(lang);
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentFiles store={s} hostId="h1" projectId="p1" kind="agent" />
      </TContext.Provider>,
    );
    const w = WORDS[lang];
    await settle(() => screen.queryByRole("button", { name: w.newAgent }) !== null);
    await press(w.newAgent);
    expect(labels().includes(w.agentName)).toBe(true);
  });

  test("an unchanged file says why Save is off, and the words go once it is edited", async () => {
    const w = await openAgent(lang);
    expect(screen.queryByText(w.nothingChanged)).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText(w.model) as HTMLInputElement, {
        target: { value: "opus" },
      });
    });
    expect(screen.queryByText(w.nothingChanged)).toBeNull();
    const save = screen.queryByRole("button", { name: w.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  test("an invalid form names what it needs, not 'nothing changed'", async () => {
    const w = await openAgent(lang);
    await act(async () => {
      fireEvent.change(screen.queryByLabelText(w.name) as HTMLInputElement, {
        target: { value: "" },
      });
    });
    expect(screen.queryByText(w.needFields)).not.toBeNull();
    expect(screen.queryByText(w.nothingChanged)).toBeNull();
  });
});

describe.each(["en", "pt-BR"] as const)("the MCP form, its labels (%s)", (lang) => {
  const edit = async (name: string) => {
    const s = await store(lang);
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentMcp store={s} hostId="h1" projectId="p1" />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByRole("button", { name }) !== null);
    await press(name);
  };

  test("a stdio server's name, transport, command, arguments and variables have visible labels", async () => {
    const w = WORDS[lang];
    await edit(w.edit);
    const wanted = [w.mcpName, w.transport, w.command, w.args, w.env];
    expect(wanted.every((l) => labels().includes(l))).toBe(true);
  });

  test("a URL server's URL and headers have visible labels", async () => {
    const w = WORDS[lang];
    await edit(w.editApi);
    expect([w.url, w.headers].every((l) => labels().includes(l))).toBe(true);
  });
});
