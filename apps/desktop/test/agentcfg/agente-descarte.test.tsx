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

/** Issue #4078: opening, creating or reloading a file over unsaved edits asks first, as the Memory tab does. */
const WORDS = {
  en: {
    first: "revisor (From the project)",
    second: "tester (From the project)",
    model: "Model",
    newAgent: "New agent",
    agentName: "Agent name",
    create: "Create",
    save: "Save",
    reload: "Reload",
    cancel: "Cancel",
    discard: "Discard",
    asks: "Discard your edits to .claude/agents/revisor.md?",
  },
  "pt-BR": {
    first: "revisor (Do projeto)",
    second: "tester (Do projeto)",
    model: "Modelo",
    newAgent: "Novo agente",
    agentName: "Nome do agente",
    create: "Criar",
    save: "Salvar",
    reload: "Recarregar",
    cancel: "Cancelar",
    discard: "Descartar",
    asks: "Descartar as edições de .claude/agents/revisor.md?",
  },
} as const;

const FILE = (name: string, model: string) =>
  `---\nname: ${name}\ndescription: Faz ${name}\nmodel: ${model}\n---\nCorpo.\n`;
const ITEMS = ["revisor", "tester"].map((name) => ({
  kind: "agent",
  path: `.claude/agents/${name}.md`,
  origin: "project",
  readOnly: false,
  hash: `h-${name}`,
  name,
}));

/** A host that lists two agents, reads them, and refuses a write: the file then changed on disk. */
async function mount(lang: Lang) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  let disk = FILE("revisor", "sonnet");
  let diskHash = "h1";
  s.hostCommand = (async (_host: string, type: string, args: { path?: string }) => {
    if (type === "agentcfg.list") return { items: ITEMS };
    if (type === "agentcfg.read") {
      if (args.path?.includes("tester")) return { content: FILE("tester", "haiku"), hash: "h2" };
      return { content: disk, hash: diskHash };
    }
    return null;
  }) as never;
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentFiles store={s} hostId="h1" projectId="p1" kind="agent" />
    </TContext.Provider>,
  );
  const w = WORDS[lang];
  await settle(() => screen.queryByRole("button", { name: w.first }) !== null);
  return {
    w,
    changeOnDisk: () => {
      disk = FILE("revisor", "opus");
      diskHash = "h3";
    },
  };
}

const click = (name: string) =>
  act(async () => {
    fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
  });
const model = (w: (typeof WORDS)[Lang]) =>
  (screen.queryByLabelText(w.model) as HTMLInputElement | null)?.value;
const typeModel = (w: (typeof WORDS)[Lang], value: string) =>
  act(async () => {
    fireEvent.change(screen.queryByLabelText(w.model) as HTMLInputElement, { target: { value } });
  });
const asking = () => screen.queryByRole("alertdialog") !== null;

describe.each(["en", "pt-BR"] as const)("agent files, unsaved edits (%s)", (lang) => {
  test("another file asks first: cancel keeps the text, discard opens the other", async () => {
    const { w } = await mount(lang);
    await click(w.first);
    await settle(() => model(w) === "sonnet");
    await typeModel(w, "opus");
    await click(w.second);
    expect(screen.queryByRole("alertdialog")?.textContent ?? "").toContain(w.asks);
    await click(w.cancel);
    expect(model(w)).toBe("opus");
    await click(w.second);
    await click(w.discard);
    await settle(() => model(w) === "haiku");
    expect(asking()).toBe(false);
  });

  test("Create asks first, and cancel keeps the open file", async () => {
    const { w } = await mount(lang);
    await click(w.first);
    await settle(() => model(w) === "sonnet");
    await typeModel(w, "opus");
    await click(w.newAgent);
    await act(async () => {
      fireEvent.change(screen.queryByLabelText(w.agentName) as HTMLInputElement, {
        target: { value: "novo" },
      });
    });
    await click(w.create);
    expect(asking()).toBe(true);
    await click(w.cancel);
    expect(model(w)).toBe("opus");
    await click(w.create);
    await click(w.discard);
    expect(screen.queryByLabelText(w.model)).not.toBeNull();
    expect(model(w)).toBe("");
  });

  test("Reload asks first, and discard shows the version on disk", async () => {
    const { w, changeOnDisk } = await mount(lang);
    await click(w.first);
    await settle(() => model(w) === "sonnet");
    await typeModel(w, "mine");
    changeOnDisk();
    await click(w.save);
    await settle(() => screen.queryByRole("button", { name: w.reload }) !== null);
    await click(w.reload);
    expect(asking()).toBe(true);
    await click(w.cancel);
    expect(model(w)).toBe("mine");
    await click(w.reload);
    await click(w.discard);
    await settle(() => model(w) === "opus");
  });

  test("with no edits, another file opens without a question", async () => {
    const { w } = await mount(lang);
    await click(w.first);
    await settle(() => model(w) === "sonnet");
    await click(w.second);
    await settle(() => model(w) === "haiku");
    expect(asking()).toBe(false);
  });
});
