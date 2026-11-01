import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { TerminalButton } = await import("../src/ui/TerminalButton.tsx");
const { UpdateBanner } = await import("../src/ui/UpdateBanner.tsx");
const { MaintenanceSection } = await import("../src/ui/MaintenanceSection.tsx");
const { SessionMessages } = await import("../src/ui/SessionMessages.tsx");
const { RunTimeline } = await import("../src/ui/RunTimeline.tsx");
const { CardReview } = await import("../src/ui/CardReview.tsx");
const { PrComments } = await import("../src/ui/PrComments.tsx");
const { RulesPreview } = await import("../src/components/vault/rules-preview.tsx");
const { RulesEditor } = await import("../src/components/vault/rules-editor.tsx");
const { VaultReport } = await import("../src/components/vault/vault-report.tsx");

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

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;

/** Pressed twice, a button is busy and disabled after the first and the work started once. */
async function expectBusyOnce(name: string, calls: unknown[][], settle: () => Promise<void>) {
  await click(button(name));
  expect(button(name)?.getAttribute("aria-busy")).toBe("true");
  expect(button(name)?.disabled).toBe(true);
  await click(button(name));
  expect(calls).toHaveLength(1);
  await settle();
  expect(button(name)?.getAttribute("aria-busy")).toBeNull();
  expect(button(name)?.disabled).toBe(false);
}

describe("botoes-pendentes: a click is answered before the work is done", () => {
  test("Abrir Claude aqui and Abrir no terminal go busy and start once", async () => {
    const here = slow();
    const open = slow();
    const store = {
      terminalLaunch: () => ({ kind: "spawn" }),
      embeddedTerminal: () => true,
      getState: () => ({ hosts: [] }),
      clientScope: () => ({ defaultPersona: () => "" }),
      openClaudeHere: here.call,
      openInTerminal: open.call,
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <TerminalButton
          store={store}
          hostId="h"
          target={{ cwd: "/repo", claudeSessionId: null } as never}
        />
      </TContext.Provider>,
    );
    await expectBusyOnce("Abrir Claude aqui (terminal)", here.calls, () => here.settle());
    await expectBusyOnce("Abrir no terminal", open.calls, () => open.settle());
  });

  test("Instalar atualização goes busy and installs once", async () => {
    const install = slow();
    const state = {
      appUpdate: { offer: { version: "1.2.3", notes: "" }, error: null },
      hosts: [],
    };
    const store = {
      i18n: { t },
      installAppUpdate: install.call,
      dismissAppUpdate: () => {},
      subscribe: () => () => {},
      getState: () => state,
    } as unknown as AppStore;
    render(<UpdateBanner store={store} />);
    await expectBusyOnce("Instalar e reiniciar", install.calls, () => install.settle());
  });

  test("Fazer backup and Simular limpeza go busy and run once", async () => {
    const backup = slow();
    const prune = slow();
    const store = {
      i18n: { t },
      formatDateTime: (iso: string) => iso,
      hostCommand: (_host: string, command: string, ...rest: unknown[]) => {
        if (command === "maintenance.backup") return backup.call(...rest);
        if (command === "maintenance.prune") return prune.call(...rest);
        return Promise.resolve(null);
      },
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <MaintenanceSection store={store} hostId="h" />
      </TContext.Provider>,
    );
    await act(() => Bun.sleep(10));
    await expectBusyOnce("Fazer backup agora", backup.calls, () => backup.settle(null));
    await expectBusyOnce("Simular", prune.calls, () => prune.settle(null));
  });

  test("Enviar mensagem goes busy and sends once", async () => {
    const send = slow();
    const store = {
      i18n: { t },
      onMessageUpdated: () => () => {},
      hostCommand: (_host: string, command: string, ...rest: unknown[]) => {
        if (command === "messages.send") return send.call(...rest);
        if (command === "messages.sessions") {
          return Promise.resolve({ sessions: [{ address: "a@h", name: "alfa" }] });
        }
        return Promise.resolve({ messages: [] });
      },
    } as unknown as AppStore;
    render(<SessionMessages store={store} hostId="h" sessionId="s1" />);
    await act(() => Bun.sleep(10));
    await click(button("Mandar para outra sessão…"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Texto da mensagem"), { target: { value: "oi" } });
    });
    await expectBusyOnce("Enviar", send.calls, () => send.settle(null));
  });

  test("Aprovar and Recusar on a gate share one answer: busy at once, the other off, sent once", async () => {
    const answer = slow();
    const step = {
      stepId: "revisar",
      attempt: 1,
      type: "gate",
      status: "waiting",
      message: "Pode seguir?",
    };
    render(
      <TContext.Provider value={t}>
        <RunTimeline
          run={
            {
              workflowName: "w",
              status: "running",
              steps: [step],
              usage: { turns: 0, minutes: 0, costUsd: 0 },
              budget: {},
            } as never
          }
          formatTime={(iso) => iso}
          onOpenStep={() => {}}
          onRespond={answer.call}
        />
      </TContext.Provider>,
    );
    await click(button("Aprovar"));
    expect(button("Aprovar")?.getAttribute("aria-busy")).toBe("true");
    expect(button("Recusar")?.disabled).toBe(true);
    await click(button("Aprovar"));
    await click(button("Recusar"));
    expect(answer.calls).toHaveLength(1);
    await answer.settle();
    expect(button("Aprovar")?.disabled).toBe(false);
    expect(button("Recusar")?.disabled).toBe(false);
  });

  test("Atualizar com a base goes busy and updates once", async () => {
    const update = slow();
    const store = {
      hostRequest: (_host: string, _command: string, ...rest: unknown[]) => update.call(...rest),
      success: () => {},
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <CardReview
          store={store}
          hostId="h"
          card={{ id: "c1", prUrl: null } as never}
          changes={{ base: "main", position: { ahead: 1, behind: 2 } } as never}
          refresh={async () => {}}
        />
      </TContext.Provider>,
    );
    await expectBusyOnce("Atualizar com a base", update.calls, () =>
      update.settle({ ok: true, data: {} }),
    );
  });

  test("Enviar comentários goes busy and sends once", async () => {
    const send = slow();
    const store = {
      hostCommand: (_host: string, command: string, ...rest: unknown[]) =>
        command === "pr.comments.send"
          ? send.call(...rest)
          : Promise.resolve({
              comments: [{ id: "k1", author: "ana", body: "ajuste", resolved: false, path: null }],
            }),
      success: () => {},
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <PrComments store={store} hostId="h" cardId="c1" moment="m" />
      </TContext.Provider>,
    );
    await act(() => Bun.sleep(10));
    await expectBusyOnce("Enviar ao agente (1)", send.calls, () => send.settle({ sent: 1 }));
  });

  test("Prever goes busy and asks the host once", async () => {
    const preview = slow();
    const store = { previewVaultUse: preview.call } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <RulesPreview store={store} secretId="s1" />
      </TContext.Provider>,
    );
    await expectBusyOnce("Prever", preview.calls, () =>
      preview.settle({ decision: "allow", reason: "regra 1" }),
    );
  });

  test("Salvar regras goes busy and saves once, and a refusal brings the button back", async () => {
    const save = slow();
    const store = {
      vaultRules: () => [],
      getState: () => ({ clientList: [] }),
      previewVaultUse: () => Promise.resolve(null),
      setVaultRules: save.call,
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <RulesEditor
          store={store}
          secret={{ id: "s1", name: "chave" } as never}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await expectBusyOnce("Salvar regras", save.calls, () =>
      save.settle({ ok: false, code: "invalid", message: "regra inválida" }),
    );
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  test("Exportar CSV goes busy and exports once", async () => {
    const exported = slow();
    const state = {
      secrets: [],
      hosts: [{ id: "h", name: "alfa", status: "online", hostInfo: { features: ["actions"] } }],
    };
    const store = {
      hostCommand: (_host: string, _command: string, payload: { format?: string }) =>
        payload.format === "csv"
          ? exported.call(payload)
          : Promise.resolve({ rows: [], decisions: [] }),
      saveFile: () => Promise.resolve(),
      subscribe: () => () => {},
      getState: () => state,
    } as unknown as AppStore;
    render(
      <TContext.Provider value={t}>
        <VaultReport store={store} />
      </TContext.Provider>,
    );
    await act(() => Bun.sleep(10));
    await expectBusyOnce("Exportar CSV", exported.calls, () => exported.settle({ csv: "a,b" }));
  });
});
