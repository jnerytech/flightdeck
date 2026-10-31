import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ActionInfo } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ArenaStartForm } = await import("../src/ui/ArenaStartForm.tsx");
const { ActionForm } = await import("../src/ui/ActionForm.tsx");
const { AutomationForm } = await import("../src/ui/AutomationForm.tsx");
const { AgentMcp } = await import("../src/ui/AgentMcp.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);

const store = () => new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });

/** The form that holds `element`: Enter in a field of it submits it, and a textarea is left alone. */
const formAround = (element: HTMLElement | null) => element?.closest("form") ?? null;
const submit = async (form: HTMLFormElement | null) => {
  expect(form).not.toBeNull();
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
  await act(() => Bun.sleep(30));
};
const type = (name: string) =>
  (screen.queryByRole("button", { name }) as HTMLButtonElement | null)?.type;

describe("form-enter: dialogs are forms", () => {
  test("Iniciar em arena: the fields sit in a form, Enter starts the arena, Cancelar does not submit", async () => {
    const started: unknown[] = [];
    render(
      <TContext.Provider value={store().i18n.t}>
        <ArenaStartForm onStart={(variants) => started.push(variants)} onClose={() => {}} />
      </TContext.Provider>,
    );
    const form = formAround(screen.queryByLabelText("Modelo da variante 1"));
    expect(type("Iniciar")).toBe("submit");
    await submit(form);
    expect(started).toEqual([[{}, {}]]);
    const cancel = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancelar",
    );
    expect(cancel?.type).toBe("button");
  });

  test("Nova ação: Enter saves through actions.save; the command textarea is left for new lines", async () => {
    const s = store();
    const asked: string[] = [];
    s.hostRequest = (async (_host: string, type: string) => {
      asked.push(type);
      return { ok: false, code: "bad_request", message: "recusado" };
    }) as typeof s.hostRequest;
    render(
      <TContext.Provider value={s.i18n.t}>
        <ActionForm
          store={s}
          hostId="h"
          projectId="p"
          initial={null as ActionInfo | null}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </TContext.Provider>,
    );
    const form = formAround(screen.queryByLabelText("Nome da ação"));
    expect(formAround(screen.queryByLabelText("Comando, um argumento por linha"))).toBe(form);
    expect(type("Salvar")).toBe("submit");
    await submit(form);
    expect(asked).toEqual(["actions.save"]);
    expect(screen.queryByRole("alert")?.textContent).toContain("recusado");
  });

  test("Nova automação: Enter advances a step until the last, and then saves", async () => {
    const s = store();
    const asked: string[] = [];
    s.hostRequest = (async (_host: string, type: string) => {
      asked.push(type);
      return { ok: false, code: "bad_request", message: "recusado" };
    }) as typeof s.hostRequest;
    render(
      <TContext.Provider value={s.i18n.t}>
        <AutomationForm
          store={s}
          hostId="h"
          projectId="p"
          workflows={[]}
          initial={null}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </TContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
    expect(type("Próximo")).toBe("submit");
    const form = formAround(screen.queryByRole("button", { name: "Próximo" }));
    await submit(form);
    expect(screen.queryByRole("button", { name: "Voltar" })?.getAttribute("type")).toBe("button");
    await submit(formAround(screen.queryByRole("button", { name: "Próximo" })));
    expect(asked).toEqual([]);
    expect(type("Salvar")).toBe("submit");
    await submit(formAround(screen.queryByRole("button", { name: "Salvar" })));
    expect(asked).toEqual(["automations.save"]);
  });

  test("Novo servidor MCP: Enter saves into the .mcp.json", async () => {
    const s = store();
    const asked: string[] = [];
    s.hostCommand = (async (_host: string, type: string) => {
      asked.push(type);
      return type === "mcp.list" ? { servers: [] } : null;
    }) as typeof s.hostCommand;
    render(
      <TContext.Provider value={s.i18n.t}>
        <AgentMcp store={s} hostId="h" projectId="p" />
      </TContext.Provider>,
    );
    for (let i = 0; i < 100 && !screen.queryByRole("button", { name: "Adicionar servidor" }); i++) {
      await act(() => Bun.sleep(20));
    }
    const add = screen.queryByRole("button", { name: "Adicionar servidor" });
    expect(add).not.toBeNull();
    await act(async () => {
      fireEvent.click(add as HTMLElement);
    });
    expect(screen.queryByLabelText("Nome do servidor")).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Nome do servidor") as HTMLElement, {
        target: { value: "eco" },
      });
      fireEvent.change(screen.queryByLabelText("Comando") as HTMLElement, {
        target: { value: "node" },
      });
    });
    const form = formAround(screen.queryByLabelText("Nome do servidor"));
    expect(type("Salvar no .mcp.json")).toBe("submit");
    await submit(form);
    expect(asked).toContain("mcp.save");
  });
});
