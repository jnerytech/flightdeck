import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { BudgetsSection } = await import("../src/ui/BudgetsSection.tsx");
const { MessagingRulesSection } = await import("../src/ui/MessagingRulesSection.tsx");
const { NewSecretForm } = await import("../src/components/vault/new-secret-form.tsx");
const { PersonaEditor } = await import("../src/components/personas/persona-editor.tsx");
const { SnippetEditor } = await import("../src/components/snippets/snippet-editor.tsx");
const { ActionForm } = await import("../src/ui/ActionForm.tsx");
const { TargetForm } = await import("../src/components/connections/target-form.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

setDefaultTimeout(30_000);
afterEach(cleanup);

const t = translator("pt-BR");

/** A call that stays pending until `settle()`, as a slow host does; `calls` counts the presses. */
function slow() {
  const calls: unknown[][] = [];
  let release: (value?: unknown) => void = () => {};
  const call = (...args: unknown[]) => {
    calls.push(args);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  return { calls, call, settle: (value?: unknown) => act(async () => release(value)) };
}

const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;
const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};
const submit = async (form: HTMLFormElement | null) => {
  expect(form).not.toBeNull();
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
};
const formOf = (name: string) => button(name)?.closest("form") ?? null;

/** Submitted twice (Enter held down), a form is busy after the first and its work started once. */
async function expectBusyOnce(
  primary: string,
  calls: unknown[][],
  settle: () => Promise<void>,
  form: () => HTMLFormElement | null = () => formOf(primary),
) {
  await submit(form());
  expect(button(primary)?.getAttribute("aria-busy")).toBe("true");
  expect(button(primary)?.disabled).toBe(true);
  await submit(form());
  expect(calls).toHaveLength(1);
  await settle();
  expect(button(primary)?.getAttribute("aria-busy")).toBeNull();
}

describe("formularios-pendentes: a form answers Enter before the work is done", () => {
  test("Criar orçamento goes busy and saves once", async () => {
    const save = slow();
    const store = {
      today: () => "2026-10-15",
      hostCommand: () => Promise.resolve(null),
      clientScope: () => ({ includes: () => true }),
      subscribe: () => () => {},
      getState: () => ({ clientSelection: "all" }),
      setBudget: save.call,
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <BudgetsSection store={store} hostId="h" hostName="alfa" budgets={[]} />
      </TContext.Provider>,
    );
    await type("Limite (US$)", "10");
    await expectBusyOnce("Criar orçamento", save.calls, () => save.settle());
  });

  test("Adicionar exceção and Salvar retenção go busy and save once each", async () => {
    const save = slow();
    const store = {
      hostCommand: () =>
        Promise.resolve({ policy: { exceptions: [], retentionDays: 7 }, paused: [] }),
      hostRequest: save.call,
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <MessagingRulesSection store={store} hostId="h" hostName="alfa" />
      </TContext.Provider>,
    );
    await act(() => Bun.sleep(10));
    await type("Origem", "alfa");
    await type("Destino", "beta");
    const result = { ok: true, data: { policy: { exceptions: [], retentionDays: 7 }, paused: [] } };
    await expectBusyOnce("Adicionar exceção", save.calls, () => save.settle(result));
    const before = save.calls.length;
    await submit(formOf("Salvar retenção"));
    expect(button("Salvar retenção")?.getAttribute("aria-busy")).toBe("true");
    await submit(formOf("Salvar retenção"));
    expect(save.calls).toHaveLength(before + 1);
    await save.settle(result);
    expect(button("Salvar retenção")?.getAttribute("aria-busy")).toBeNull();
  });

  test("Guardar, Gerar chave SSH and Importar arquivo de chave go busy and start once", async () => {
    const add = slow();
    const generate = slow();
    const importKey = slow();
    const store = {
      addSecret: add.call,
      generateSshKey: generate.call,
      importKeyFile: importKey.call,
      copyText: () => Promise.resolve(true),
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <NewSecretForm store={store} onClose={() => {}} />
      </TContext.Provider>,
    );
    await type("Nome", "chave");
    await type("Valor", "segredo");
    await expectBusyOnce("Guardar", add.calls, () => add.settle());
    for (const [name, work] of [
      ["Gerar chave SSH", generate],
      ["Importar arquivo de chave", importKey],
    ] as const) {
      await act(async () => {
        fireEvent.click(button(name) as HTMLElement);
      });
      expect(button(name)?.getAttribute("aria-busy")).toBe("true");
      await act(async () => {
        fireEvent.click(button(name) as HTMLElement);
      });
      expect(work.calls).toHaveLength(1);
      await work.settle(null);
      expect(button(name)?.getAttribute("aria-busy")).toBeNull();
    }
  });

  test("Salvar persona goes busy and saves once, and a refusal brings the form back", async () => {
    const save = slow();
    const store = { hostRequest: save.call, personaRef: () => null } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <PersonaEditor
          store={store}
          hostId="h"
          project=""
          persona={null}
          onSaved={() => {}}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await type("Id", "revisor");
    await type("Nome", "Revisor");
    await type("Descrição", "revisa");
    await type("Instruções", "Revise com cuidado.");
    await expectBusyOnce("Salvar persona", save.calls, () =>
      save.settle({ ok: false, code: "invalid", message: "persona inválida" }),
    );
    expect(screen.queryByText("persona inválida")).not.toBeNull();
    expect(button("Salvar persona")?.disabled).toBe(false);
  });

  test("Salvar snippet goes busy and saves once", async () => {
    const save = slow();
    const store = { hostRequest: save.call } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <SnippetEditor
          store={store}
          hostId="h"
          project=""
          snippet={null}
          onSaved={() => {}}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await type("Nome", "status");
    await type("Comando", "git status");
    await expectBusyOnce("Salvar snippet", save.calls, () =>
      save.settle({ ok: false, code: "invalid", message: "snippet inválido" }),
    );
    expect(button("Salvar snippet")?.disabled).toBe(false);
  });

  test("Salvar (ação) goes busy and saves once", async () => {
    const save = slow();
    const store = {
      i18n: { t },
      getState: () => ({ secrets: [] }),
      hostRequest: save.call,
    } as unknown as AppStore;
    render(
      <ActionForm
        store={store}
        hostId="h"
        projectId="p"
        initial={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await type("Nome da ação", "testar");
    await type("Comando, um argumento por linha", "bun\ntest");
    await expectBusyOnce("Salvar", save.calls, () =>
      save.settle({ ok: false, code: "invalid", message: "ação inválida" }),
    );
    expect(button("Salvar")?.disabled).toBe(false);
  });

  test("Salvar destino goes busy and saves once", async () => {
    const save = slow();
    const state = { secrets: [], hosts: [] };
    const store = {
      hostCommand: save.call,
      subscribe: () => () => {},
      getState: () => state,
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <TargetForm
          store={store}
          hostId="h"
          target={null}
          others={[]}
          onSaved={() => {}}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await type("Nome", "servidor");
    await type("Host", "10.0.0.1");
    await type("Usuário", "ana");
    await expectBusyOnce("Salvar destino", save.calls, () => save.settle(null));
    expect(button("Salvar destino")?.disabled).toBe(false);
  });
});
