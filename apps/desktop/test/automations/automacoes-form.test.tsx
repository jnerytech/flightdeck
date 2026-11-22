import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AutomationForm } = await import("../../src/features/automations/automation-form.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #3857: every field of the automation form has a visible label, and a bad name or limit is said before any request. */
const WORDS = {
  en: {
    trigger: "Trigger",
    cron: "Cron expression",
    tz: "Time zone",
    action: "Action",
    workflow: "Workflow",
    name: "Automation name",
    max: "Maximum firings per day",
    hint: "minute hour day month weekday. Example: 0 9 * * 1-5 is weekdays at 09:00.",
    nameMissing: "Give the automation a name.",
    label: "Label",
    cronRefused: "5 fields",
    tzRefused: "The time zone Mars/Base is not known",
    otherRefused: "The automation gone does not exist.",
    labelMissing: "Type the label to watch for before going on.",
    workflowMissing:
      "This project has no valid workflow to start. Add one in the project's workflows, then come back.",
    maxBad: "The limit is a whole number of at least 1.",
    next: "Next",
    save: "Save",
  },
  "pt-BR": {
    trigger: "Gatilho",
    cron: "Expressão cron",
    tz: "Fuso horário",
    action: "Ação",
    workflow: "Workflow",
    name: "Nome da automação",
    max: "Máximo de disparos por dia",
    hint: "minuto hora dia mês dia-da-semana. Exemplo: 0 9 * * 1-5 é de segunda a sexta às 09:00.",
    nameMissing: "Dê um nome à automação.",
    label: "Rótulo",
    cronRefused: "5 campos",
    tzRefused: "Mars/Base",
    otherRefused: "A automação gone não existe.",
    labelMissing: "Digite o rótulo a observar antes de continuar.",
    workflowMissing:
      "Este projeto não tem um workflow válido para iniciar. Crie um nos workflows do projeto e volte.",
    maxBad: "O limite é um número inteiro de pelo menos 1.",
    next: "Próximo",
    save: "Salvar",
  },
} as const;

const WORKFLOW = { name: "feature", hash: "h", trusted: true, checks: [], errors: [], inputs: [] };

type Asked = Array<{ type: string; payload: Record<string, unknown> }>;
type Refusal = {
  code: string;
  message: string;
  reason?: string;
  params?: Record<string, string | number>;
};

/** The form on a store whose `automation.save` is recorded and answers with the saved automation. */
async function form(lang: Lang, workflows = [WORKFLOW], refuse?: Refusal) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online: true, features: ["automations"] }]);
  const asked: Asked = [];
  // What went through `hostCommand`: its refusals become a toast, which a field's own message replaces.
  const toasting: Asked = [];
  store.hostCommand = (async (_host: string, type: string, payload: Record<string, unknown>) => {
    asked.push({ type, payload });
    toasting.push({ type, payload });
    return { id: "a1", name: payload.name, enabled: false };
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: Record<string, unknown>) => {
    asked.push({ type, payload });
    return refuse
      ? { ok: false, ...refuse }
      : { ok: true, data: { id: "a1", name: payload.name, enabled: false } };
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <AutomationForm
        store={store}
        hostId="h1"
        projectId="p1"
        workflows={workflows}
        initial={null}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </TContext.Provider>,
  );
  await act(async () => {});
  return { asked, toasting };
}

describe.each(["en", "pt-BR"] as const)("the automation form, its fields (%s)", (lang) => {
  const w = WORDS[lang];
  const press = (name: string) =>
    act(async () => {
      fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
    });
  const type = (label: string, value: string) =>
    act(async () => {
      fireEvent.change(screen.queryByLabelText(label) as HTMLInputElement, { target: { value } });
    });
  /** The texts of the visible labels on the screen: a bare aria-label is not one. */
  const labels = () => [...document.querySelectorAll("label")].map((l) => l.textContent);
  /** The form at its last step, with a name and a workflow in place. */
  const lastStep = async () => {
    await press(w.next);
    await press(w.next);
  };

  test("step 1 labels the trigger, the cron and the time zone, and keeps the cron hint visible", async () => {
    await form(lang);
    expect([w.trigger, w.cron, w.tz].every((label) => labels().includes(label))).toBe(true);
    expect(screen.queryByText(w.hint)).not.toBeNull();
    // The hint stays while the field has text: the prefilled schedule does not hide it.
    expect((screen.queryByLabelText(w.cron) as HTMLInputElement).value).toBe("0 9 * * 1-5");
  });

  test("step 2 labels the action and the workflow", async () => {
    await form(lang);
    await press(w.next);
    expect([w.action, w.workflow].every((label) => labels().includes(label))).toBe(true);
  });

  test("step 3 labels the name and the limit", async () => {
    await form(lang);
    await lastStep();
    expect([w.name, w.max].every((label) => labels().includes(label))).toBe(true);
  });

  const next = () => screen.queryByRole("button", { name: w.next }) as HTMLButtonElement | null;
  const pickTrigger = (value: string) =>
    act(async () => {
      fireEvent.change(screen.queryByLabelText(w.trigger) as HTMLSelectElement, {
        target: { value },
      });
    });

  test("a label trigger with no label blocks Next and says why, and a label lets it go (#4187)", async () => {
    await form(lang);
    await pickTrigger("issue_label");
    const blocked = [next()?.disabled, screen.queryByText(w.labelMissing) !== null];
    await type(w.label, "   ");
    const blank = next()?.disabled;
    await type(w.label, "auto");
    expect({
      blocked,
      blank,
      free: next()?.disabled,
      said: screen.queryByText(w.labelMissing) !== null,
    }).toEqual({
      blocked: [true, true],
      blank: true,
      free: false,
      said: false,
    });
  });

  test("a workflow action with no valid workflow blocks Next on step 2 and says why (#4187)", async () => {
    await form(lang, []);
    await press(w.next);
    expect([next()?.disabled, screen.queryByText(w.workflowMissing) !== null]).toEqual([
      true,
      true,
    ]);
  });

  test("a workflow that has errors does not count as valid (#4187)", async () => {
    await form(lang, [{ ...WORKFLOW, errors: ["bad"] } as never]);
    await press(w.next);
    expect(next()?.disabled).toBe(true);
  });

  /** The form filled to its last step and saved: the host answers with `refuse`. */
  const refusedSave = async (refuse: Refusal, edit?: () => Promise<void>) => {
    const made = await form(lang, [WORKFLOW], refuse);
    if (edit) await edit();
    await lastStep();
    await type(w.name, "nightly");
    await press(w.save);
    return made;
  };
  const CRON_REFUSED = { code: "bad_request", message: "raw cron", reason: "cron_fields" };
  const TZ_REFUSED = {
    code: "bad_request",
    message: "raw tz",
    reason: "automation_tz_unknown",
    params: { tz: "Mars/Base" },
  };
  const focused = (label: string) => document.activeElement === screen.queryByLabelText(label);
  const alertText = () => screen.queryByRole("alert")?.textContent ?? "";

  test("a refused cron goes back to the trigger step, says why on the cron field and focuses it (#4188)", async () => {
    const { toasting } = await refusedSave(CRON_REFUSED);
    expect({
      step: screen.queryByLabelText(w.cron) !== null,
      said: alertText().includes(w.cronRefused),
      invalid: screen.queryByLabelText(w.cron)?.getAttribute("aria-invalid"),
      focused: focused(w.cron),
      toasted: toasting.filter((a) => a.type === "automation.save").length,
    }).toEqual({ step: true, said: true, invalid: "true", focused: true, toasted: 0 });
  });

  test("a refused time zone says why on the time zone field and focuses it (#4188)", async () => {
    await refusedSave(TZ_REFUSED);
    expect({
      said: alertText().includes(w.tzRefused),
      invalid: screen.queryByLabelText(w.tz)?.getAttribute("aria-invalid"),
      cronFine: screen.queryByLabelText(w.cron)?.getAttribute("aria-invalid"),
      focused: focused(w.tz),
    }).toEqual({ said: true, invalid: "true", cronFine: null, focused: true });
  });

  test("the message on the cron field goes away when the field is edited (#4188)", async () => {
    await refusedSave(CRON_REFUSED);
    const shown = [screen.queryByLabelText(w.cron) !== null, alertText().includes(w.cronRefused)];
    if (shown[0]) await type(w.cron, "0 8 * * *");
    expect({ shown, after: screen.queryByRole("alert") !== null }).toEqual({
      shown: [true, true],
      after: false,
    });
  });

  test("a refused cron does not come back after the trigger is changed and changed back (#4188)", async () => {
    await refusedSave(CRON_REFUSED);
    const before =
      screen.queryByLabelText(w.trigger) !== null && alertText().includes(w.cronRefused);
    if (before) {
      await pickTrigger("issue_label");
      await pickTrigger("cron");
    }
    expect({
      before,
      cronBack: screen.queryByLabelText(w.cron) !== null,
      said: alertText().includes(w.cronRefused),
    }).toEqual({ before: true, cronBack: true, said: false });
  });

  test("a refusal that is not about a field stays on the last step, in the dialog (#4188)", async () => {
    await refusedSave({
      code: "not_found",
      message: "raw",
      reason: "automation_not_found",
      params: { id: "gone" },
    });
    expect({
      last: screen.queryByLabelText(w.name) !== null,
      said: alertText().includes(w.otherRefused),
    }).toEqual({ last: true, said: true });
  });

  test("the time zone suggests the known zones and still takes any text (#4188)", async () => {
    await form(lang);
    const field = screen.queryByLabelText(w.tz) as HTMLInputElement;
    const list = document.getElementById(field.getAttribute("list") ?? "");
    const zones = [...(list?.querySelectorAll("option") ?? [])].map((o) => o.getAttribute("value"));
    await type(w.tz, "Mars/Base");
    expect({
      zones: zones.includes("America/Sao_Paulo"),
      free: (screen.queryByLabelText(w.tz) as HTMLInputElement).value,
    }).toEqual({ zones: true, free: "Mars/Base" });
  });

  test("an empty name is said on the field and nothing is sent", async () => {
    const { asked } = await form(lang);
    await lastStep();
    await press(w.save);
    expect(screen.queryByRole("alert")?.textContent?.includes(w.nameMissing)).toBe(true);
    expect(screen.queryByLabelText(w.name)?.getAttribute("aria-invalid")).toBe("true");
    expect(asked.filter((a) => a.type === "automation.save")).toEqual([]);
  });

  test.each(["0", "-1", "", "2.5", "99999999999999999999"])(
    "a limit of %p is said on the field and nothing is sent",
    async (bad) => {
      const { asked } = await form(lang);
      await lastStep();
      await type(w.name, "nightly");
      await type(w.max, bad);
      await press(w.save);
      expect(screen.queryByRole("alert")?.textContent?.includes(w.maxBad)).toBe(true);
      expect(asked.filter((a) => a.type === "automation.save")).toEqual([]);
    },
  );

  test("a good name and limit are sent as typed, and the message goes away", async () => {
    const { asked } = await form(lang);
    await lastStep();
    await press(w.save);
    expect(screen.queryByRole("alert")).not.toBeNull();
    await type(w.name, "nightly");
    await type(w.max, "5");
    expect(screen.queryByRole("alert")).toBeNull();
    await press(w.save);
    const saves = asked.filter((a) => a.type === "automation.save");
    expect(saves.map((s) => [s.payload.name, s.payload.maxRunsPerDay])).toEqual([["nightly", 5]]);
  });
});
