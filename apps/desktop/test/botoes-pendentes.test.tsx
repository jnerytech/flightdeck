import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeHostStore, onWire } from "./fake-host.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { RequestError } = await import("../src/features/hosts/host-connection.ts");
const { TerminalButton } = await import("../src/features/terminal/terminal-button.tsx");
const { UpdateBanner } = await import("../src/features/appupdate/update-banner.tsx");
const { MaintenanceSection } = await import("../src/features/maintenance/maintenance-section.tsx");
const { SessionMessages } = await import("../src/features/messaging/session-messages.tsx");
const { RunTimeline } = await import("../src/features/runenv/run-timeline.tsx");
const { CardReview } = await import("../src/features/review/card-review.tsx");
const { PrComments } = await import("../src/features/review/pr-comments.tsx");
const { RulesPreview } = await import("../src/features/vault/rules-preview.tsx");
const { RulesEditor } = await import("../src/features/vault/rules-editor.tsx");
const { VaultReport } = await import("../src/features/vault/vault-report.tsx");

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
  test("Abrir Claude aqui and Copiar comando go busy and start once", async () => {
    const here = slow();
    const copy = slow();
    // A host that opens terminals in the app, behind the wire; the person's own terminal is the
    // platform's clipboard here, since a spawn needs a Windows host (a host elsewhere gets its command copied).
    const { store, platform } = await fakeHostStore(
      { "terminal.open": onWire(here.call) },
      { features: ["terminal"] },
    );
    platform.copyText = copy.call as never;
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
    await expectBusyOnce("Copiar comando", copy.calls, () => copy.settle());
  });

  test("Instalar atualização goes busy and installs once", async () => {
    const install = slow();
    const { store, platform } = await fakeHostStore();
    // The manual banner (Install and restart); updating by itself has its own test (#280).
    store.settings.setAutoUpdate(false);
    // The platform's updater is the seam: the offer comes from its check, the install is the slow call.
    platform.updater = {
      supported: true,
      check: async () => ({ version: "1.2.3", notes: "" }),
      download: async () => {},
      installDownloaded: async () => {},
      install: install.call as never,
    };
    await act(async () => store.appUpdates.check());
    render(<UpdateBanner store={store} />);
    await expectBusyOnce("Instalar e reiniciar", install.calls, () => install.settle());
  });

  test("Fazer backup and Simular limpeza go busy and run once", async () => {
    const backup = slow();
    const prune = slow();
    const { store } = await fakeHostStore({
      // The section asks for its status when it opens; this test is about the two buttons.
      "maintenance.status": () => null,
      "maintenance.backup": (payload) => backup.call(payload),
      "maintenance.prune": (payload) => prune.call(payload),
    });
    render(
      <TContext.Provider value={t}>
        <MaintenanceSection store={store} hostId="h" />
      </TContext.Provider>,
    );
    await uiIdle();
    await expectBusyOnce("Fazer backup agora", backup.calls, () => backup.settle(null));
    await expectBusyOnce("Simular", prune.calls, () => prune.settle(null));
  });

  test("Enviar mensagem goes busy and sends once", async () => {
    const send = slow();
    const { store } = await fakeHostStore(
      {
        "messages.send": (payload) => send.call(payload),
        "messages.sessions": () => ({ sessions: [{ address: "a@h", name: "alfa" }] }),
      },
      { fallback: { messages: [] } },
    );
    render(<SessionMessages store={store} hostId="h" sessionId="s1" />);
    await settle(() => button("Mandar para outra sessão…") !== null);
    await click(button("Mandar para outra sessão…"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Texto da mensagem"), { target: { value: "oi" } });
    });
    await expectBusyOnce("Enviar", send.calls, () => send.settle(null));
  });

  // Issue #182: a gate is answered with the same pair of verbs as a request, Aprovar and Negar.
  test("Aprovar and Negar on a gate share one answer: busy at once, the other off, sent once", async () => {
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
    expect(button("Negar")?.disabled).toBe(true);
    await click(button("Aprovar"));
    await click(button("Negar"));
    expect(answer.calls).toHaveLength(1);
    await answer.settle();
    expect(button("Aprovar")?.disabled).toBe(false);
    expect(button("Negar")?.disabled).toBe(false);
  });

  test("Atualizar com a base goes busy and updates once", async () => {
    const update = slow();
    const { store } = await fakeHostStore({
      "card.updateFromBase": (payload) => update.call(payload),
    });
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
    await expectBusyOnce("Atualizar com a base", update.calls, () => update.settle({}));
  });

  test("Enviar comentários goes busy and sends once", async () => {
    const send = slow();
    const { store } = await fakeHostStore(
      { "pr.comments.send": (payload) => send.call(payload) },
      {
        fallback: {
          comments: [{ id: "k1", author: "ana", body: "ajuste", resolved: false, path: null }],
        },
      },
    );
    render(
      <TContext.Provider value={t}>
        <PrComments store={store} hostId="h" cardId="c1" moment="m" />
      </TContext.Provider>,
    );
    await uiIdle();
    await expectBusyOnce("Enviar ao agente (1)", send.calls, () => send.settle({ sent: 1 }));
  });

  test("Prever goes busy and asks the host once", async () => {
    const preview = slow();
    const { store, secretIds } = await fakeHostStore(
      { "vault.rules.preview": (payload) => preview.call(payload) },
      { features: ["actions"], secrets: ["chave"] },
    );
    render(
      <TContext.Provider value={t}>
        <RulesPreview store={store} secretId={secretIds[0] ?? ""} />
      </TContext.Provider>,
    );
    await expectBusyOnce("Prever", preview.calls, () =>
      preview.settle({ decision: "allow", reason: "regra 1" }),
    );
  });

  test("Salvar regras goes busy and saves once, and a refusal brings the button back", async () => {
    const save = slow();
    const { store, secretIds } = await fakeHostStore(
      {
        // The host refuses on the wire, as a daemon does: the store turns it into a refusal.
        "vault.rules.set": onWire(save.call),
        "vault.rules.get": () => ({ rules: [] }),
      },
      { features: ["actions"], secrets: ["chave"] },
    );
    render(
      <TContext.Provider value={t}>
        <RulesEditor
          store={store}
          secret={store.getState().secrets.find((one) => one.id === secretIds[0]) as never}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await expectBusyOnce("Salvar regras", save.calls, () =>
      save.settle(new RequestError("invalid", "regra inválida")),
    );
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  test("Exportar CSV goes busy and exports once", async () => {
    const exported = slow();
    const { store, calls } = await fakeHostStore(
      {
        "vault.report": (payload: { format?: string }) =>
          payload.format === "csv" ? exported.call(payload) : { rows: [] },
        "vault.decisions": () => ({ decisions: [] }),
      },
      { features: ["actions"] },
    );
    render(
      <TContext.Provider value={t}>
        <VaultReport store={store} />
      </TContext.Provider>,
    );
    await uiIdle();
    await expectBusyOnce("Exportar CSV", exported.calls, () => exported.settle({ csv: "a,b" }));
    expect(calls.some((call) => call.type === "vault.report")).toBe(true);
  });
});
