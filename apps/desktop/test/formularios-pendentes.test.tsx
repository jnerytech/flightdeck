import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeHostStore, onWire } from "./fake-host.ts";
import { uiIdle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { RequestError } = await import("../src/lib/host-connection.ts");
const { BudgetsSection } = await import("../src/features/costs/budgets-section.tsx");
const { MessagingRulesSection } = await import("../src/features/messaging/rules-section.tsx");
const { NewSecretForm } = await import("../src/features/vault/new-secret-form.tsx");
const { PersonaEditor } = await import("../src/features/personas/persona-editor.tsx");
const { SnippetEditor } = await import("../src/features/snippets/snippet-editor.tsx");
const { ActionForm } = await import("../src/features/actions/action-form.tsx");
const { TargetForm } = await import("../src/features/ssh/target-form.tsx");

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
    const { store } = await fakeHostStore({
      "costs.summary": () => null,
      "budget.set": onWire(save.call),
    });
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
    const { store } = await fakeHostStore({
      "messaging.rules.get": () => ({ policy: { exceptions: [], retentionDays: 7 }, paused: [] }),
      "messaging.rules.set": onWire(save.call),
    });
    render(
      <TContext.Provider value={t}>
        <MessagingRulesSection store={store} hostId="h" hostName="alfa" />
      </TContext.Provider>,
    );
    await uiIdle();
    await type("Origem", "alfa");
    await type("Destino", "beta");
    const result = { policy: { exceptions: [], retentionDays: 7 }, paused: [] };
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
    // The platform's vault is the seam: the real store, slice and vault run over it.
    const { store, platform } = await fakeHostStore();
    const storeValue = platform.vault.set;
    platform.vault.set = add.call as never;
    platform.vault.generateKey = generate.call as never;
    platform.vault.pickFile = importKey.call as never;
    render(
      <TContext.Provider value={t}>
        <NewSecretForm store={store} onClose={() => {}} />
      </TContext.Provider>,
    );
    await type("Nome", "chave");
    await type("Valor", "segredo");
    await expectBusyOnce("Guardar", add.calls, () => add.settle());
    // The key made is stored by the vault as any secret: its value goes to the real store.
    platform.vault.set = storeValue;
    for (const [name, work, answer] of [
      ["Importar arquivo de chave", importKey, null],
      ["Gerar chave SSH", generate, { privateKey: "k", publicKey: "ssh-ed25519 AAA" }],
    ] as const) {
      await act(async () => {
        fireEvent.click(button(name) as HTMLElement);
      });
      expect(button(name)?.getAttribute("aria-busy")).toBe("true");
      await act(async () => {
        fireEvent.click(button(name) as HTMLElement);
      });
      expect(work.calls).toHaveLength(1);
      await work.settle(answer);
      expect(button(name)?.getAttribute("aria-busy")).toBeNull();
    }
    expect(screen.queryByText("ssh-ed25519 AAA")).not.toBeNull();
  });

  test("Salvar persona goes busy and saves once, and a refusal brings the form back", async () => {
    const save = slow();
    const { store } = await fakeHostStore({ "personas.save": onWire(save.call) });
    render(
      <TContext.Provider value={t}>
        <PersonaEditor
          store={store}
          hostId="h"
          project=""
          persona={null}
          onSaved={() => {}}
          onClose={() => {}}
          onOpenSettings={() => {}}
        />
      </TContext.Provider>,
    );
    await type("Id", "revisor");
    await type("Nome", "Revisor");
    await type("Descrição", "revisa");
    await type("Instruções", "Revise com cuidado.");
    await expectBusyOnce("Salvar persona", save.calls, () =>
      save.settle(new RequestError("invalid", "persona inválida")),
    );
    expect(screen.queryByText("persona inválida")).not.toBeNull();
    expect(button("Salvar persona")?.disabled).toBe(false);
  });

  test("Salvar snippet goes busy and saves once", async () => {
    const save = slow();
    const { store } = await fakeHostStore({ "snippets.save": onWire(save.call) });
    render(
      <TContext.Provider value={t}>
        <SnippetEditor
          store={store}
          hostId="h"
          project=""
          snippet={null}
          onSaved={() => {}}
          onClose={() => {}}
          onOpenSettings={() => {}}
        />
      </TContext.Provider>,
    );
    await type("Nome", "status");
    await type("Comando", "git status");
    await expectBusyOnce("Salvar snippet", save.calls, () =>
      save.settle(new RequestError("invalid", "snippet inválido")),
    );
    expect(button("Salvar snippet")?.disabled).toBe(false);
  });

  test("Salvar (ação) goes busy and saves once", async () => {
    const save = slow();
    const { store } = await fakeHostStore({ "actions.save": onWire(save.call) });
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
      save.settle(new RequestError("invalid", "ação inválida")),
    );
    expect(button("Salvar")?.disabled).toBe(false);
  });

  test("Salvar destino goes busy and saves once", async () => {
    const save = slow();
    const { store } = await fakeHostStore({ "ssh.save": (payload) => save.call(payload) });
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
