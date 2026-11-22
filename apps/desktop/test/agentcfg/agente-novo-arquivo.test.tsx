import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentFiles } = await import("../../src/features/agentcfg/agent-files.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";
type Kind = "agent" | "claudemd";

/** Issue #4080: the new-file field is a form with its rule, takes the focus, and hands it to the new editor. */
const WORDS = {
  en: {
    newAgent: "New agent",
    agentName: "Agent name",
    newClaudemd: "New CLAUDE.md",
    pathLabel: "Path of the CLAUDE.md",
    create: "Create",
    name: "Name",
    ruleAgent: "Letters, digits, _, . and -, starting with a letter or digit.",
    refusedAgent: "That name is not allowed.",
    ruleClaudemd: "A path ending in CLAUDE.md, or CLAUDE.local.md.",
    refusedClaudemd: "That path is not allowed.",
  },
  "pt-BR": {
    newAgent: "Novo agente",
    agentName: "Nome do agente",
    newClaudemd: "Novo CLAUDE.md",
    pathLabel: "Caminho do CLAUDE.md",
    create: "Criar",
    name: "Nome",
    ruleAgent: "Letras, dígitos, _, . e -, começando por letra ou dígito.",
    refusedAgent: "Esse nome não é permitido.",
    ruleClaudemd: "Um caminho que termina em CLAUDE.md, ou CLAUDE.local.md.",
    refusedClaudemd: "Esse caminho não é permitido.",
  },
} as const;

async function mount(lang: Lang, kind: Kind) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  s.hostCommand = (async (_host: string, type: string) =>
    type === "agentcfg.list" ? { items: [] } : null) as never;
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentFiles store={s} hostId="h1" projectId="p1" kind={kind} />
    </TContext.Provider>,
  );
  const w = WORDS[lang];
  const add = kind === "agent" ? w.newAgent : w.newClaudemd;
  await settle(() => screen.queryByRole("button", { name: add }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: add }) as HTMLElement);
  });
  const label = kind === "agent" ? w.agentName : w.pathLabel;
  return { w, field: screen.queryByLabelText(label) as HTMLInputElement | null };
}

const typeInto = (field: HTMLInputElement, value: string) =>
  act(async () => {
    fireEvent.change(field, { target: { value } });
  });
const createButton = (w: (typeof WORDS)[Lang]) =>
  screen.queryByRole("button", { name: w.create }) as HTMLButtonElement | null;
const submit = (field: HTMLInputElement) =>
  act(async () => {
    const form = field.closest("form");
    if (form) fireEvent.submit(form);
  });

describe.each(["en", "pt-BR"] as const)("agent files, new file (%s)", (lang) => {
  test("the field takes the focus when it opens", async () => {
    const { field } = await mount(lang, "agent");
    expect(field).not.toBeNull();
    expect(field !== null && document.activeElement === field).toBe(true);
  });

  test("the field and Create are one form, and Enter creates the file with the focus on its Name", async () => {
    const { w, field } = await mount(lang, "agent");
    expect(field?.closest("form")).not.toBeNull();
    expect(createButton(w)?.type).toBe("submit");
    expect(createButton(w)?.closest("form") === field?.closest("form")).toBe(true);
    await typeInto(field as HTMLInputElement, "revisor");
    await submit(field as HTMLInputElement);
    const name = screen.queryByLabelText(w.name) as HTMLInputElement | null;
    expect(name?.value).toBe("revisor");
    expect(name !== null && document.activeElement === name).toBe(true);
    expect(screen.queryByLabelText(w.agentName)).toBeNull();
  });

  test("a refused name shows its error, keeps Create disabled and creates nothing", async () => {
    const { w, field } = await mount(lang, "agent");
    expect(screen.queryByText(w.ruleAgent)).not.toBeNull();
    expect(screen.queryByText(w.refusedAgent)).toBeNull();
    await typeInto(field as HTMLInputElement, "a b");
    expect(screen.queryByText(w.refusedAgent)).not.toBeNull();
    expect(createButton(w)?.disabled).toBe(true);
    await submit(field as HTMLInputElement);
    expect(screen.queryByLabelText(w.name)).toBeNull();
    expect(screen.queryByLabelText(w.agentName)).not.toBeNull();
  });

  test("a CLAUDE.md shows the path rule, not the name rule, and the focus goes to its content", async () => {
    const { w, field } = await mount(lang, "claudemd");
    expect(screen.queryByText(w.ruleClaudemd)).not.toBeNull();
    expect(screen.queryByText(w.ruleAgent)).toBeNull();
    await typeInto(field as HTMLInputElement, "docs/nope.md");
    expect(screen.queryByText(w.refusedClaudemd)).not.toBeNull();
    await typeInto(field as HTMLInputElement, "docs/CLAUDE.md");
    expect(screen.queryByText(w.refusedClaudemd)).toBeNull();
    await submit(field as HTMLInputElement);
    const body = screen.queryByRole("textbox") as HTMLTextAreaElement | null;
    expect(body?.tagName).toBe("TEXTAREA");
    expect(body !== null && document.activeElement === body).toBe(true);
  });
});
