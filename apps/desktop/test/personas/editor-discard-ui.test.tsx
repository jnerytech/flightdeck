import { afterEach, describe, expect, test } from "bun:test";
import type { AppPersona } from "../../src/features/personas/domain/global-personas.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { PersonaEditor } = await import("../../src/features/personas/persona-editor.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

afterEach(cleanup);

/** Issue #4213: Cancel on a form with changes asks before it drops what was typed. */
const WORDS = {
  en: {
    name: "Name",
    cancel: "Cancel",
    discard: "Discard",
    message: "Discard what you typed? It will be lost.",
  },
  "pt-BR": {
    name: "Nome",
    cancel: "Cancelar",
    discard: "Descartar",
    message: "Descartar o que você escreveu? Isso se perde.",
  },
} as const;

const persona: AppPersona = {
  id: "qa",
  name: "QA",
  description: "Writes the failing test first",
  body: "Write the test first.",
  icon: null,
  model: null,
  effort: null,
  tools: null,
  permissionMode: null,
  hash: null,
  scope: "host",
  trusted: true,
  modified: false,
};

function setup(lang: "en" | "pt-BR", existing: boolean) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  let closed = 0;
  render(
    <TContext.Provider value={store.i18n.t}>
      <TooltipProvider>
        <PersonaEditor
          store={store}
          hostId="h1"
          project=""
          persona={existing ? persona : null}
          onSaved={() => {}}
          onClose={() => {
            closed++;
          }}
          onOpenSettings={() => {}}
        />
      </TooltipProvider>
    </TContext.Provider>,
  );
  const words = WORDS[lang];
  const body = () => within(document.body);
  const press = async (name: string) => {
    const button = body().queryByRole("button", { name });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    await uiIdle();
  };
  const ask = () => document.querySelector("[role='alertdialog']");
  const type = async (value: string) => {
    const box = body().queryByLabelText(words.name);
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(box as HTMLElement, { target: { value } });
    });
    await uiIdle();
  };
  const typed = () => (body().queryByLabelText(words.name) as HTMLInputElement | null)?.value;
  return { words, press, ask, type, typed, closed: () => closed };
}

describe.each(["en", "pt-BR"] as const)("persona editor: Cancel with changes (%s)", (lang) => {
  test("a form nobody touched closes at once", async () => {
    const form = setup(lang, true);
    await form.press(form.words.cancel);
    expect([form.closed(), form.ask() === null]).toEqual([1, true]);
  });

  test("a typed form asks first, and keeping on leaves the text where it was", async () => {
    const form = setup(lang, false);
    await form.type("Meu QA");
    await form.press(form.words.cancel);
    expect([form.closed(), form.ask()?.textContent?.includes(form.words.message)]).toEqual([
      0,
      true,
    ]);
    expect(form.ask()).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        within(form.ask() as HTMLElement).getByRole("button", { name: form.words.cancel }),
      );
    });
    await uiIdle();
    expect([form.closed(), form.ask() === null, form.typed()]).toEqual([0, true, "Meu QA"]);
  });

  test("confirming the question closes the form", async () => {
    const form = setup(lang, true);
    await form.type("QA 2");
    await form.press(form.words.cancel);
    expect(form.ask()).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        within(form.ask() as HTMLElement).getByRole("button", { name: form.words.discard }),
      );
    });
    await uiIdle();
    expect(form.closed()).toBe(1);
  });

  test("a change put back to what it was is no change", async () => {
    const form = setup(lang, true);
    await form.type("QA 2");
    await form.type("QA");
    await form.press(form.words.cancel);
    expect([form.closed(), form.ask() === null]).toEqual([1, true]);
  });
});
