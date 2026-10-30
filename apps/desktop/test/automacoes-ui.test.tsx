import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionsFor, carriesThirdParty, TRIGGER_TYPES } from "../src/lib/automations.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
/** The on/off switch of an automation: a switch, not a button. */
const toggle = async (name: string) => {
  const control = screen.queryByRole("switch", { name });
  expect(control).not.toBeNull();
  await act(async () => {
    fireEvent.click(control as HTMLElement);
  });
};
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};
const options = (label: string) =>
  [...((screen.queryByLabelText(label) as HTMLSelectElement | null)?.options ?? [])].map(
    (o) => o.textContent ?? "",
  );

const WORKFLOW = "steps:\n  - id: plan\n    agent: { prompt: 'plan it' }\n";

describe("automacoes-ui: what a trigger can drive", () => {
  test("each trigger offers the actions the daemon accepts for it, and no others", () => {
    expect(TRIGGER_TYPES).toEqual(["cron", "pr_comment", "ci_failed", "issue_label"]);
    expect(actionsFor("cron")).toEqual(["start_workflow"]);
    expect(actionsFor("pr_comment")).toEqual(["start_workflow", "send_to_card"]);
    expect(actionsFor("ci_failed")).toEqual(["start_workflow", "send_to_card"]);
    expect(actionsFor("issue_label")).toEqual(["start_workflow", "create_card"]);
  });

  test("only a comment and an issue can carry text from a stranger", () => {
    expect(TRIGGER_TYPES.filter(carriesThirdParty)).toEqual(["pr_comment", "issue_label"]);
  });
});

/** A host with a project and one trusted workflow, on the projects screen. */
async function online(features?: string[]) {
  const d = await workflowDaemon(cleanups, { revisar: WORKFLOW, outro: WORKFLOW }, ["revisar", "outro"], {
    automations: true,
  });
  const server = features ? d.listen(0, undefined, features) : d.server;
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Workflows de repo" }) !== null);
  return { ...d, store };
}
const automationsOf = (d: Awaited<ReturnType<typeof online>>) =>
  d.automations?.list(d.project.id) ?? [];
const row = (name: string) => screen.queryByRole("listitem", { name: `Automação ${name}` });

/** Fills the guided form with an issue-label trigger starting the trusted workflow, and saves. */
async function createLabelAutomation(name = "Revisar issues auto") {
  await click("Automações de repo");
  await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
  await click("Nova automação");
  await change("Gatilho", "issue_label");
  await change("Rótulo", "auto");
  await click("Próximo");
  await change("Ação", "start_workflow");
  // The project's workflows load beside the list: the picker appears when they are here.
  await settle(() => screen.queryByLabelText("Workflow") !== null);
  await change("Workflow", "revisar");
  await click("Próximo");
  await change("Nome da automação", name);
  await click("Salvar");
}

describe("automacoes-ui: the screen", () => {
  test("Projetos has an Automações button per project that opens the project's list, empty at first", async () => {
    await online();
    await click("Automações de repo");
    await settle(() => screen.queryByRole("heading", { name: "Automações de repo" }) !== null);
    expect(screen.queryByRole("heading", { name: "Automações de repo" })).not.toBeNull();
    await settle(() => screen.queryByText("Nenhuma automação neste projeto") !== null);
    expect(screen.queryByText("Nenhuma automação neste projeto")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Nova automação" })).not.toBeNull();
  });

  test("a daemon without the automation feature has no Automações button", async () => {
    await online(["workflows"]);
    expect(screen.queryByRole("button", { name: "Automações de repo" })).toBeNull();
  });
});

describe("automacoes-ui: the guided creation", () => {
  test("trigger, action and limit in three steps; the automation is saved off, with the daemon's values", async () => {
    const d = await online();
    await createLabelAutomation();
    await settle(() => automationsOf(d).length === 1);
    expect(automationsOf(d)[0]).toMatchObject({
      name: "Revisar issues auto",
      enabled: false,
      trigger: { type: "issue_label", label: "auto" },
      action: { type: "start_workflow", workflow: "revisar" },
      maxRunsPerDay: 10,
      allowExternalAuthors: false,
    });
    await settle(() => row("Revisar issues auto") !== null);
    const saved = row("Revisar issues auto") as HTMLElement;
    expect(saved.textContent).toContain("Desligada");
    expect(saved.textContent).toContain("Issue nova com o rótulo auto");
    expect(saved.textContent).toContain("Iniciar o workflow revisar");
    expect(saved.textContent).toContain("Até 10 disparos por dia");
    expect(screen.queryByRole("dialog", { name: "Nova automação" })).toBeNull();
  });

  test("each step says where you are and Voltar keeps what was typed", async () => {
    await online();
    await click("Automações de repo");
    await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
    await click("Nova automação");
    expect(screen.queryByText("Passo 1 de 3: Gatilho")).not.toBeNull();
    await change("Gatilho", "issue_label");
    await change("Rótulo", "urgente");
    await click("Próximo");
    expect(screen.queryByText("Passo 2 de 3: Ação")).not.toBeNull();
    await click("Voltar");
    expect((screen.queryByLabelText("Rótulo") as HTMLInputElement).value).toBe("urgente");
    await click("Próximo");
    await click("Próximo");
    expect(screen.queryByText("Passo 3 de 3: Limite")).not.toBeNull();
  });

  test("the action list follows the trigger: cron only starts a workflow, a CI failure can also message the card", async () => {
    await online();
    await click("Automações de repo");
    await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
    await click("Nova automação");
    const actionsOf = async (trigger: string) => {
      await change("Gatilho", trigger);
      await click("Próximo");
      const list = options("Ação");
      await click("Voltar");
      return list;
    };
    expect(await actionsOf("cron")).toEqual(["Iniciar um workflow"]);
    expect(await actionsOf("ci_failed")).toEqual([
      "Iniciar um workflow",
      "Mandar o conteúdo do evento ao card",
    ]);
    expect(await actionsOf("issue_label")).toEqual([
      "Iniciar um workflow",
      "Criar um card da issue",
    ]);
  });

  test("the workflow comes from the project's workflows", async () => {
    await online();
    await click("Automações de repo");
    await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
    await click("Nova automação");
    await click("Próximo");
    await change("Ação", "start_workflow");
    await settle(() => options("Workflow").includes("revisar"));
    expect(options("Workflow")).toContain("revisar");
  });

  test("outside authors are off by default and the switch exists only where a stranger can write", async () => {
    await online();
    await click("Automações de repo");
    await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
    await click("Nova automação");
    const reachStep3 = async (trigger: string) => {
      await change("Gatilho", trigger);
      await click("Próximo");
      await click("Próximo");
    };
    await reachStep3("cron");
    expect(screen.queryByRole("switch", { name: "Agir também sobre autores externos" })).toBeNull();
    await click("Voltar");
    await click("Voltar");
    await reachStep3("pr_comment");
    const sw = screen.queryByRole("switch", { name: "Agir também sobre autores externos" });
    expect(sw?.getAttribute("aria-checked")).toBe("false");
  });

  test("a value the daemon refuses keeps the form open and saves nothing", async () => {
    const d = await online();
    await click("Automações de repo");
    await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
    await click("Nova automação");
    await change("Expressão cron", "99 99 * * *");
    await click("Próximo");
    await click("Próximo");
    await change("Nome da automação", "Ruim");
    await click("Salvar");
    await act(() => Bun.sleep(300));
    expect(automationsOf(d)).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "Nova automação" })).not.toBeNull();
  });
});

describe("automacoes-ui: turning on and off", () => {
  test("turning on shows the trigger and the action first, and only Ligar turns it on", async () => {
    const d = await online();
    await createLabelAutomation();
    await settle(() => row("Revisar issues auto") !== null);
    await toggle("Ligar Revisar issues auto");
    const confirm = screen.queryByRole("alertdialog");
    expect(confirm).not.toBeNull();
    expect((confirm as HTMLElement).textContent).toContain("Issue nova com o rótulo auto");
    expect((confirm as HTMLElement).textContent).toContain("Iniciar o workflow revisar");
    expect(automationsOf(d)[0]?.enabled).toBe(false);
    await click("Cancelar");
    expect(automationsOf(d)[0]?.enabled).toBe(false);
    await toggle("Ligar Revisar issues auto");
    await click("Ligar", screen.queryByRole("alertdialog"));
    await settle(() => automationsOf(d)[0]?.enabled === true);
    expect(automationsOf(d)[0]?.enabled).toBe(true);
    await settle(() => (row("Revisar issues auto")?.textContent ?? "").includes("Ligada"));
    expect(row("Revisar issues auto")?.textContent).toContain("Ligada");
  });

  test("turning off needs no confirmation", async () => {
    const d = await online();
    await createLabelAutomation();
    await settle(() => row("Revisar issues auto") !== null);
    await toggle("Ligar Revisar issues auto");
    await click("Ligar", screen.queryByRole("alertdialog"));
    await settle(() => automationsOf(d)[0]?.enabled === true);
    await settle(() => (row("Revisar issues auto")?.textContent ?? "").includes("Ligada"));
    await toggle("Ligar Revisar issues auto");
    await settle(() => automationsOf(d)[0]?.enabled === false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(automationsOf(d)[0]?.enabled).toBe(false);
  });

  test("an automation that acts on outside authors says so in the confirmation", async () => {
    const d = await online();
    d.automations?.save({
      projectId: d.project.id,
      name: "Comentários",
      trigger: { type: "pr_comment" },
      action: { type: "start_workflow", workflow: "revisar" },
      allowExternalAuthors: true,
    });
    await click("Automações de repo");
    await settle(() => row("Comentários") !== null);
    expect(row("Comentários")?.textContent).toContain("Aceita autores externos");
    await toggle("Ligar Comentários");
    expect(screen.queryByRole("alertdialog")?.textContent).toContain("não confiável");
  });
});

describe("automacoes-ui: history, edit and remove", () => {
  test("the history lists each firing with its time, cause, outcome and detail, newest first", async () => {
    const d = await online();
    const saved = d.automations?.save({
      projectId: d.project.id,
      name: "Diária",
      trigger: { type: "cron", expr: "0 9 * * 1-5", tz: "America/Sao_Paulo" },
      action: { type: "start_workflow", workflow: "revisar" },
    });
    const seed = (id: string, at: string, cause: string, status: string, detail: string | null) =>
      d.eventStore.db
        .query(
          "INSERT INTO automation_runs (id, automation_id, fired_at, cause, status, detail) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, saved?.id ?? "", at, cause, status, detail);
    seed("r1", "2026-10-28T12:00:00.000Z", "cron 09:00", "ok", null);
    seed("r2", "2026-10-29T12:00:00.000Z", "cron 09:00", "failed", "workflow not found");
    seed("r3", "2026-10-30T12:00:00.000Z", "cron 09:00", "limited", "10 of 10 today");
    await click("Automações de repo");
    await settle(() => row("Diária") !== null);
    await click("Histórico", row("Diária"));
    await settle(() => screen.queryByRole("list", { name: "Disparos de Diária" }) !== null);
    const runs = [
      ...(screen.queryByRole("list", { name: "Disparos de Diária" })?.querySelectorAll("li") ?? []),
    ].map((li) => li.textContent ?? "");
    expect(runs).toHaveLength(3);
    expect(runs[0]).toContain("Limite do dia");
    expect(runs[0]).toContain("10 of 10 today");
    expect(runs[1]).toContain("Falhou");
    expect(runs[1]).toContain("workflow not found");
    expect(runs[2]).toContain("Executou");
    expect(runs[0]).toContain("cron 09:00");
    await click("Esconder histórico", row("Diária"));
    expect(screen.queryByRole("list", { name: "Disparos de Diária" })).toBeNull();
  });

  test("an automation that never fired says so", async () => {
    const d = await online();
    d.automations?.save({
      projectId: d.project.id,
      name: "Nova",
      trigger: { type: "ci_failed" },
      action: { type: "send_to_card" },
    });
    await click("Automações de repo");
    await settle(() => row("Nova") !== null);
    await click("Histórico", row("Nova"));
    await settle(() => screen.queryByText("Nenhum disparo ainda") !== null);
    expect(screen.queryByText("Nenhum disparo ainda")).not.toBeNull();
  });

  test("editing starts from the saved values and saves the automation off again", async () => {
    const d = await online();
    await createLabelAutomation();
    await settle(() => row("Revisar issues auto") !== null);
    await toggle("Ligar Revisar issues auto");
    await click("Ligar", screen.queryByRole("alertdialog"));
    await settle(() => automationsOf(d)[0]?.enabled === true);
    await settle(() => (row("Revisar issues auto")?.textContent ?? "").includes("Ligada"));
    await click("Editar", row("Revisar issues auto"));
    expect((screen.queryByLabelText("Rótulo") as HTMLInputElement).value).toBe("auto");
    await change("Rótulo", "urgente");
    await click("Próximo");
    await click("Próximo");
    expect(
      screen.queryByText("Salvar desliga a automação até você ligá-la de novo"),
    ).not.toBeNull();
    await change("Máximo de disparos por dia", "3");
    await click("Salvar");
    await settle(() => automationsOf(d)[0]?.maxRunsPerDay === 3);
    expect(automationsOf(d)).toHaveLength(1);
    expect(automationsOf(d)[0]).toMatchObject({
      enabled: false,
      trigger: { type: "issue_label", label: "urgente" },
      maxRunsPerDay: 3,
    });
  });

  test("removing asks first and then takes the automation and its history away", async () => {
    const d = await online();
    await createLabelAutomation();
    await settle(() => row("Revisar issues auto") !== null);
    await click("Excluir", row("Revisar issues auto"));
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    await click("Cancelar");
    expect(automationsOf(d)).toHaveLength(1);
    await click("Excluir", row("Revisar issues auto"));
    await click("Excluir", screen.queryByRole("alertdialog"));
    await settle(() => automationsOf(d).length === 0);
    expect(automationsOf(d)).toHaveLength(0);
    await settle(() => row("Revisar issues auto") === null);
    expect(row("Revisar issues auto")).toBeNull();
  });
});

describe("automacoes-ui: the other triggers and actions", () => {
  const openForm = async () => {
    await click("Automações de repo");
    await settle(() => screen.queryByRole("button", { name: "Nova automação" }) !== null);
    await click("Nova automação");
  };

  test("a PR comment can message the card, with outside authors allowed by its switch", async () => {
    const d = await online();
    await openForm();
    await change("Gatilho", "pr_comment");
    await click("Próximo");
    await change("Ação", "send_to_card");
    await click("Próximo");
    await change("Nome da automação", "Comentários");
    const control = screen.queryByRole("switch", { name: "Agir também sobre autores externos" });
    expect(control).not.toBeNull();
    await act(async () => {
      fireEvent.click(control as HTMLElement);
    });
    await click("Salvar");
    await settle(() => automationsOf(d).length === 1);
    expect(automationsOf(d)[0]).toMatchObject({
      enabled: false,
      trigger: { type: "pr_comment" },
      action: { type: "send_to_card" },
      allowExternalAuthors: true,
    });
  });

  test("a schedule keeps the time zone that was typed and the workflow that was picked", async () => {
    const d = await online();
    await openForm();
    await change("Expressão cron", "30 8 * * 1");
    await change("Fuso horário", "America/Sao_Paulo");
    await click("Próximo");
    await settle(() => options("Workflow").includes("revisar"));
    // "outro" is the one the picker starts on, so picking "revisar" is a real choice.
    await change("Workflow", "revisar");
    await click("Próximo");
    await change("Nome da automação", "Segunda cedo");
    await click("Salvar");
    await settle(() => automationsOf(d).length === 1);
    expect(automationsOf(d)[0]).toMatchObject({
      trigger: { type: "cron", expr: "30 8 * * 1", tz: "America/Sao_Paulo" },
      action: { type: "start_workflow", workflow: "revisar" },
      allowExternalAuthors: false,
    });
  });

  test("Cancelar closes the form and saves nothing", async () => {
    const d = await online();
    await openForm();
    await click("Cancelar");
    expect(screen.queryByRole("dialog", { name: "Nova automação" })).toBeNull();
    expect(automationsOf(d)).toHaveLength(0);
  });
});
