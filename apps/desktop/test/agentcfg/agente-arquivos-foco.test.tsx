import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentFiles } = await import("../../src/features/agentcfg/agent-files.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #4266: focus on open, the open row's mark, the unsaved and new-file cues, and closing the New file form. */
const WORDS = {
  en: {
    open: (n: string) => `${n} (From the project)`,
    add: "New agent",
    agentName: "Agent name",
    create: "Create",
    cancel: "Cancel",
    name: "Name",
    description: "Description",
    save: "Save",
    saved: "Saved.",
    unsaved: "Unsaved changes",
    newFile: "New file: it exists after Save.",
  },
  "pt-BR": {
    open: (n: string) => `${n} (Do projeto)`,
    add: "Novo agente",
    agentName: "Nome do agente",
    create: "Criar",
    cancel: "Cancelar",
    name: "Nome",
    description: "Descrição",
    save: "Salvar",
    saved: "Salvo.",
    unsaved: "Alterações não salvas",
    newFile: "Arquivo novo: ele passa a existir depois de Salvar.",
  },
} as const;

const item = (name: string) => ({
  kind: "agent",
  path: `.claude/agents/${name}.md`,
  origin: "project",
  readOnly: false,
  hash: `hash-${name}`,
  name,
});
const textOf = (name: string) => `---\nname: ${name}\ndescription: d\n---\nBody.\n`;

/** The Agents tab over a host that holds two agents and takes every save. */
async function mount(lang: Lang) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  s.hostCommand = (async (_host: string, type: string, payload: { path?: string }) => {
    if (type === "agentcfg.list") return { items: [item("revisor"), item("tester")] };
    if (type === "agentcfg.read") {
      const name = /agents\/(.*)\.md$/.exec(payload.path ?? "")?.[1] ?? "x";
      return { content: textOf(name), hash: `hash-${name}` };
    }
    if (type === "agentcfg.write") return { hash: "hash-saved" };
    return null;
  }) as never;
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentFiles store={s} hostId="h1" projectId="p1" kind="agent" />
    </TContext.Provider>,
  );
  const w = WORDS[lang];
  await settle(() => screen.queryByRole("button", { name: w.open("revisor") }) !== null);
  return w;
}

describe.each(["en", "pt-BR"] as const)(
  "agent files: focus, the open row and the cues (%s)",
  (lang) => {
    const focused = () => document.activeElement as HTMLElement | null;
    const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;

    async function press(name: string) {
      const element = screen.queryByRole("button", { name });
      expect(element).not.toBeNull();
      await act(async () => {
        fireEvent.click(element as HTMLElement);
      });
      await uiIdle();
    }
    async function edit(label: string, value: string) {
      await act(async () => {
        fireEvent.change(field(label) as HTMLElement, { target: { value } });
      });
    }

    test("opening a file puts the focus in its first field", async () => {
      const w = await mount(lang);
      await press(w.open("revisor"));
      await settle(() => field(w.name) !== null);
      await uiIdle();
      expect(focused() === field(w.name)).toBe(true);
    });

    test("opening another file moves the focus to that file's first field", async () => {
      const w = await mount(lang);
      await press(w.open("revisor"));
      await settle(() => field(w.name)?.value === "revisor");
      await press(w.open("tester"));
      await settle(() => field(w.name)?.value === "tester");
      await uiIdle();
      expect(focused() === field(w.name)).toBe(true);
    });

    test("a save does not move the focus off the field being edited", async () => {
      const w = await mount(lang);
      await press(w.open("revisor"));
      await settle(() => field(w.description) !== null);
      await edit(w.description, "changed");
      await act(async () => {
        field(w.description)?.focus();
      });
      await press(w.save);
      await settle(() => screen.queryByText(w.saved) !== null);
      expect(focused() === field(w.description)).toBe(true);
    });

    test("the open file's row has a mark that is not only a colour, and no other row has one", async () => {
      const w = await mount(lang);
      await press(w.open("revisor"));
      await settle(() => field(w.name) !== null);
      const mark = (name: string) =>
        screen
          .queryByRole("button", { name: w.open(name) })
          ?.closest("li")
          ?.querySelector("[data-row-leading]") !== null;
      expect({ open: mark("revisor"), other: mark("tester") }).toEqual({
        open: true,
        other: false,
      });
    });

    test("while the text differs from the file, Unsaved changes shows beside Save, and Saved replaces it", async () => {
      const w = await mount(lang);
      await press(w.open("revisor"));
      await settle(() => field(w.description) !== null);
      const said = () => screen.queryByText(w.unsaved) !== null;
      const opened = said();
      await edit(w.description, "changed");
      const edited = said();
      await press(w.save);
      await settle(() => screen.queryByText(w.saved) !== null);
      expect({ opened, edited, saved: said() }).toEqual({
        opened: false,
        edited: true,
        saved: false,
      });
    });

    test("a new file says it does not exist yet until it is saved", async () => {
      const w = await mount(lang);
      await press(w.add);
      await edit(w.agentName, "draft");
      await press(w.create);
      await settle(() => field(w.name)?.value === "draft");
      const says = () => screen.queryByText(w.newFile) !== null;
      const before = says();
      await edit(w.description, "a draft");
      await press(w.save);
      await settle(() => screen.queryByText(w.saved) !== null);
      expect({ before, after: says() }).toEqual({ before: true, after: false });
    });

    test("an opened file does not say it is new", async () => {
      const w = await mount(lang);
      await press(w.open("revisor"));
      await settle(() => field(w.name) !== null);
      expect(screen.queryByText(w.newFile)).toBeNull();
    });

    test("Cancel closes the New file form, clears what was typed and puts the focus back on New agent", async () => {
      const w = await mount(lang);
      await press(w.add);
      await edit(w.agentName, "draft");
      await press(w.cancel);
      const closed = field(w.agentName) === null;
      const onNew = focused() === screen.queryByRole("button", { name: w.add });
      await press(w.add);
      expect({ closed, onNew, reopened: field(w.agentName)?.value, editor: field(w.name) }).toEqual(
        {
          closed: true,
          onNew: true,
          reopened: "",
          editor: null,
        },
      );
    });

    test("Escape in the name field closes the form like Cancel and reaches no parent", async () => {
      const w = await mount(lang);
      let reached = false;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") reached = true;
      };
      document.body.addEventListener("keydown", onKey);
      try {
        await press(w.add);
        await edit(w.agentName, "draft");
        await act(async () => {
          fireEvent.keyDown(field(w.agentName) as HTMLElement, { key: "Escape" });
        });
      } finally {
        document.body.removeEventListener("keydown", onKey);
      }
      expect({
        closed: field(w.agentName) === null,
        onNew: focused() === screen.queryByRole("button", { name: w.add }),
        reached,
      }).toEqual({ closed: true, onNew: true, reached: false });
    });
  },
);
