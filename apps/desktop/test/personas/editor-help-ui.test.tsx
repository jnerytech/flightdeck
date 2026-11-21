import { afterEach, describe, expect, test } from "bun:test";
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

/** Issue #3632: the persona editor says what it needs and what it refuses before Save, in the app's language. */
const LABELS = {
  "pt-BR": {
    id: "Id",
    name: "Nome",
    description: "Descrição",
    icon: "Ícone",
    body: "Instruções",
    effort: "Esforço",
    mode: "Modo de permissão sugerido",
    place: "Onde guardar",
    save: "Salvar persona",
  },
  en: {
    id: "Id",
    name: "Name",
    description: "Description",
    icon: "Icon",
    body: "Instructions",
    effort: "Effort",
    mode: "Suggested permission mode",
    place: "Where to keep it",
    save: "Save persona",
  },
} as const;

function setup(lang: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <TooltipProvider>
        <PersonaEditor
          store={store}
          hostId="h1"
          project=""
          persona={null}
          onSaved={() => {}}
          onClose={() => {}}
          onOpenSettings={() => {}}
        />
      </TooltipProvider>
    </TContext.Provider>,
  );
  const names = LABELS[lang];
  const control = (key: keyof typeof LABELS.en) =>
    within(document.body).queryByLabelText(names[key]) as HTMLInputElement | null;
  /** The text the control points to with aria-describedby: its help and its error. */
  const described = (key: keyof typeof LABELS.en) =>
    (control(key)?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
  const save = () => within(document.body).queryByRole("button", { name: names.save });
  const type = async (key: keyof typeof LABELS.en, value: string) => {
    expect(control(key)).not.toBeNull();
    await act(async () => {
      fireEvent.change(control(key) as HTMLElement, { target: { value } });
    });
    await uiIdle();
  };
  const leave = async (key: keyof typeof LABELS.en) => {
    expect(control(key)).not.toBeNull();
    await act(async () => {
      fireEvent.blur(control(key) as HTMLElement);
    });
    await uiIdle();
  };
  const fillAll = async () => {
    await type("id", "meu-qa");
    await type("name", "Meu QA");
    await type("description", "Testes antes de tudo");
    await type("body", "Escreva o teste antes.");
  };
  /** What the form says near the Save button when it is off. */
  const why = () => {
    const button = save();
    return (button?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  };
  return { control, described, save, type, leave, fillAll, why };
}

describe("editor help: what a field needs is said before Save (#3632)", () => {
  test("a required field is marked, and the Save button says what is missing", async () => {
    const form = setup("pt-BR");
    const marked = (["id", "name", "description", "body"] as const).map(
      (key) => form.control(key)?.getAttribute("aria-required") === "true",
    );
    expect(marked).toEqual([true, true, true, true]);
    expect(form.described("body")).toContain("Obrigatório");
    expect(form.why()).toBe("Para salvar, preencha ou corrija: Id, Nome, Descrição, Instruções.");
    await form.type("id", "meu-qa");
    await form.type("name", "Meu QA");
    await form.type("description", "Testes antes de tudo");
    expect(form.why()).toBe("Para salvar, preencha ou corrija: Instruções.");
    await form.type("body", "Escreva o teste antes.");
    expect([form.save()?.hasAttribute("disabled"), form.why()]).toEqual([false, ""]);
  });

  test("the same line reads in English", () => {
    const form = setup("en");
    expect(form.why()).toBe("To save, fill in or fix: Id, Name, Description, Instructions.");
    expect(form.described("body")).toContain("Required");
  });

  test("an id that breaks the rule is said on the field when it is left, and Save stays off", async () => {
    const form = setup("pt-BR");
    expect(form.described("id")).toContain("Letras minúsculas, dígitos e hífens, até 40");
    await form.fillAll();
    await form.type("id", "Meu Persona");
    expect(form.control("id")?.hasAttribute("aria-invalid")).toBe(false);
    await form.leave("id");
    expect(form.control("id")?.getAttribute("aria-invalid")).toBe("true");
    expect(form.described("id")).toContain("Use letras minúsculas, dígitos e hífens, até 40");
    expect([form.save()?.hasAttribute("disabled"), form.why()]).toEqual([
      true,
      "Para salvar, preencha ou corrija: Id.",
    ]);
    await form.type("id", "meu-persona");
    await form.leave("id");
    expect([
      form.control("id")?.hasAttribute("aria-invalid"),
      form.save()?.hasAttribute("disabled"),
    ]).toEqual([false, false]);
  });

  test("an icon that breaks the rule is said on the field when it is left", async () => {
    const form = setup("pt-BR");
    await form.fillAll();
    await form.type("icon", "Rocket!");
    await form.leave("icon");
    expect(form.control("icon")?.getAttribute("aria-invalid")).toBe("true");
    expect(form.save()?.hasAttribute("disabled")).toBe(true);
    await form.type("icon", "rocket");
    expect([
      form.control("icon")?.hasAttribute("aria-invalid"),
      form.save()?.hasAttribute("disabled"),
    ]).toEqual([false, false]);
  });
});

describe("editor help: a refusal reads in the app's language (#3632)", () => {
  test("a refusal the model gives is shown from its reason, not its English message", async () => {
    const form = setup("pt-BR");
    await form.fillAll();
    await form.type("name", "x".repeat(300));
    await act(async () => {
      fireEvent.change(form.control("place") as HTMLElement, { target: { value: "app" } });
    });
    await act(async () => {
      fireEvent.click(form.save() as HTMLElement);
    });
    await uiIdle();
    const alert = within(document.body).queryByRole("alert")?.textContent ?? "";
    expect(/^name: de 1 a \d+ caracteres\.$/.test(alert)).toBe(true);
  });
});

describe("editor help: the options have names (#3632)", () => {
  const options = (select: HTMLElement | null) =>
    [...(select?.querySelectorAll("option") ?? [])].map((option) => [
      option.textContent,
      option.value,
    ]);

  test("effort and permission mode show names, and keep their ids as values", () => {
    const form = setup("pt-BR");
    const effort = options(form.control("effort"));
    const mode = options(form.control("mode"));
    expect(effort).toContainEqual(["Extra alto", "xhigh"]);
    expect(mode).toContainEqual(["Aceitar edições", "acceptEdits"]);
    expect(mode).toContainEqual(["Só o permitido", "dontAsk"]);
    expect(mode).toContainEqual(["Automático", "auto"]);
  });

  test("the names read in English too", () => {
    const form = setup("en");
    expect(options(form.control("effort"))).toContainEqual(["Extra high", "xhigh"]);
    expect(options(form.control("mode"))).toContainEqual(["Allowed only", "dontAsk"]);
  });

  test("every control is a shared field, so each has the same help slot", () => {
    const form = setup("pt-BR");
    const natives = ["effort", "mode", "place"].map((key) =>
      form.control(key as keyof typeof LABELS.en)?.getAttribute("data-slot"),
    );
    expect(natives).toEqual(["native-select", "native-select", "native-select"]);
  });
});
