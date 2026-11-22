import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { memoriaHost } from "../memoria-ui-setup.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Lang = "en" | "pt-BR";

/** Issues #4230, #4231 and #4235: focus, the open row, the New memory form, the type words and the unsaved cues of Memory. */
const WORDS = {
  en: {
    tab: "Memory",
    open: (n: string) => `Open ${n}`,
    list: "Memories",
    add: "New memory",
    fileName: "File name",
    create: "Create",
    cancel: "Cancel",
    content: (n: string) => `Content of ${n}`,
    save: "Save",
    confirmSave: "Save to memory",
    unsaved: "Unsaved changes",
    newFile: "New file: it exists after Save.",
    saved: "Memory saved.",
    user: "User",
    outOfIndex: "Not in the index",
    feedback: "Feedback",
  },
  "pt-BR": {
    tab: "Memória",
    open: (n: string) => `Abrir ${n}`,
    list: "Memórias",
    add: "Nova memória",
    fileName: "Nome do arquivo",
    create: "Criar",
    cancel: "Cancelar",
    content: (n: string) => `Conteúdo de ${n}`,
    save: "Salvar",
    confirmSave: "Salvar na memória",
    unsaved: "Alterações não salvas",
    newFile: "Arquivo novo: ele passa a existir depois de Salvar.",
    saved: "Memória salva.",
    user: "Usuário",
    outOfIndex: "Fora do índice",
    feedback: "Feedback",
  },
} as const;

const INDEX =
  "- [Role](user_role.md) — who the user is\n- [Tests](feedback_tests.md) — tests first\n";
const typed = (type: string) => `---\nname: x\ndescription: d\ntype: ${type}\n---\nBody.\n`;

describe.each(["en", "pt-BR"] as const)(
  "Memory: focus, the open row and the unsaved cues (%s)",
  (lang: Lang) => {
    const w = WORDS[lang];

    /** The Agent screen of the project, on its Memory tab, over a memory the test wrote first. */
    async function memory(seed: (put: (name: string, text: string) => void) => void) {
      const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
      cleanups.push(() => store.dispose());
      await store.i18n.setLang(lang);
      const h = await memoriaHost(cleanups, store);
      seed(h.put);
      render(<App store={store} />);
      await settle(
        () => store.getState().hosts[0]?.hostInfo?.features?.includes("memory") === true,
      );
      await act(async () => {
        store.router.push({
          name: "agent",
          host: h.hostId,
          projectId: h.projectId,
          projectName: "repo",
        });
      });
      await settle(() => screen.queryByRole("tab", { name: w.tab }) !== null);
      const tab = screen.queryByRole("tab", { name: w.tab });
      if (tab) {
        await act(async () => {
          fireEvent.mouseDown(tab, { button: 0 });
        });
      }
      await settle(() => screen.queryByRole("button", { name: w.open("user_role.md") }) !== null);
      return h;
    }

    const seeded = (put: (name: string, text: string) => void) => {
      put("MEMORY.md", INDEX);
      put("user_role.md", typed("user"));
      put("feedback_tests.md", typed("feedback"));
    };

    async function press(name: string | RegExp) {
      const element = screen.queryByRole("button", { name });
      expect(element).not.toBeNull();
      await act(async () => {
        fireEvent.click(element as HTMLElement);
      });
      await uiIdle();
    }

    const textarea = (name: string) =>
      screen.queryByLabelText(w.content(name)) as HTMLElement | null;
    const focused = () => document.activeElement as HTMLElement | null;

    async function fill(label: string, value: string) {
      const field = screen.queryByLabelText(label) as HTMLElement;
      await act(async () => {
        fireEvent.change(field, { target: { value } });
      });
    }

    test("opening a file puts the focus in its editor", async () => {
      await memory(seeded);
      await press(w.open("user_role.md"));
      await settle(() => textarea("user_role.md") !== null);
      await uiIdle();
      expect(focused() === textarea("user_role.md")).toBe(true);
    });

    test("the open file's row button says it is the current one, and no other does", async () => {
      await memory(seeded);
      await press(w.open("user_role.md"));
      await settle(() => textarea("user_role.md") !== null);
      const current = (name: string) =>
        screen.queryByRole("button", { name: w.open(name) })?.getAttribute("aria-current");
      expect({ open: current("user_role.md"), other: current("feedback_tests.md") }).toEqual({
        open: "true",
        other: null,
      });
    });

    test("the open file's row has a mark that is not only a colour", async () => {
      await memory(seeded);
      await press(w.open("user_role.md"));
      await settle(() => textarea("user_role.md") !== null);
      const mark = (name: string) =>
        screen
          .queryByRole("button", { name: w.open(name) })
          ?.closest("li")
          ?.querySelector("[data-row-leading]") !== null;
      expect({ open: mark("user_role.md"), other: mark("feedback_tests.md") }).toEqual({
        open: true,
        other: false,
      });
    });

    test("New memory puts the focus in the name field", async () => {
      await memory(seeded);
      await press(w.add);
      await settle(() => screen.queryByLabelText(w.fileName) !== null);
      expect(focused() === screen.queryByLabelText(w.fileName)).toBe(true);
    });

    test("Cancel closes the New memory form and the focus goes back to New memory", async () => {
      await memory(seeded);
      await press(w.add);
      await fill(w.fileName, "draft");
      await press(w.cancel);
      expect({
        form: screen.queryByLabelText(w.fileName) !== null,
        onNew: focused() === screen.queryByRole("button", { name: w.add }),
      }).toEqual({ form: false, onNew: true });
    });

    test("Escape in the name field closes the form like Cancel, and a reopened form is empty", async () => {
      await memory(seeded);
      await press(w.add);
      await fill(w.fileName, "draft");
      await act(async () => {
        fireEvent.keyDown(screen.queryByLabelText(w.fileName) as HTMLElement, { key: "Escape" });
      });
      const closed = screen.queryByLabelText(w.fileName) === null;
      await press(w.add);
      expect({
        closed,
        empty: (screen.queryByLabelText(w.fileName) as HTMLInputElement).value,
      }).toEqual({ closed: true, empty: "" });
    });

    test("a new file's editor has the focus and says it is new until it is saved", async () => {
      await memory(seeded);
      await press(w.add);
      await fill(w.fileName, "draft");
      await press(w.create);
      await settle(() => textarea("draft.md") !== null);
      const header = () => screen.queryByText(w.newFile) !== null;
      const before = { focus: focused() === textarea("draft.md"), says: header() };
      await fill(w.content("draft.md"), "Something.\n");
      await press(w.save);
      await press(w.confirmSave);
      await settle(() => screen.queryByText(w.saved) !== null);
      expect({ before, after: header() }).toEqual({
        before: { focus: true, says: true },
        after: false,
      });
    });

    test("while the text differs from the saved one, Unsaved changes shows beside Save, and Saved replaces it", async () => {
      await memory(seeded);
      await press(w.open("user_role.md"));
      await settle(() => textarea("user_role.md") !== null);
      const said = () => screen.queryByText(w.unsaved) !== null;
      const opened = said();
      await fill(w.content("user_role.md"), `${typed("user")}More.\n`);
      const edited = said();
      await press(w.save);
      await press(w.confirmSave);
      await settle(() => screen.queryByText(w.saved) !== null);
      expect({ opened, edited, saved: said() }).toEqual({
        opened: false,
        edited: true,
        saved: false,
      });
    });

    test("a file's type shows as its word in the app's language, an unknown type as it is, and none as nothing", async () => {
      await memory((put) => {
        put("MEMORY.md", INDEX);
        put("user_role.md", typed("user"));
        put("odd.md", typed("journal"));
        put("plain.md", "no front matter\n");
      });
      const meta = (name: string) =>
        screen
          .queryByRole("button", { name: w.open(name) })
          ?.closest("li")
          ?.querySelector("[data-row-meta]")?.textContent;
      await settle(
        () => screen.queryByRole("list", { name: w.list })?.querySelectorAll("li").length === 4,
      );
      expect({
        known: meta("user_role.md"),
        unknown: meta("odd.md"),
        none: meta("plain.md"),
      }).toEqual({
        known: w.user,
        unknown: `journal · ${w.outOfIndex}`,
        none: w.outOfIndex,
      });
    });
  },
);
