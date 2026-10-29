import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
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

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

const items = (label: string) =>
  [...(screen.queryByRole("list", { name: label })?.querySelectorAll("li") ?? [])].map(
    (li) => li.textContent ?? "",
  );

const FEATURE =
  "inputs: [task]\nsteps:\n  - id: plan\n    agent: { prompt: 'plano de {{inputs.task}}' }\n  - id: tests\n    check: fd-test --all\n";
const BROKEN = "steps:\n  - check: lint\n";

async function online(workflows: Record<string, string>, trusted: string[]) {
  const d = await workflowDaemon(cleanups, workflows, trusted);
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await click("Projetos de alfa");
  await settle(() => screen.queryByRole("button", { name: "Workflows de repo" }) !== null);
  return { ...d, store };
}

describe("workflows-ui", () => {
  test("a tela de workflows lista cada workflow com a validação e os comandos check", async () => {
    await online({ feature: FEATURE, quebrado: BROKEN }, []);
    await click("Workflows de repo");
    await settle(() => screen.queryByRole("listitem", { name: "Workflow feature" }) !== null);
    expect(screen.queryByRole("heading", { name: "Workflows de repo" })).not.toBeNull();
    const feature = screen.queryByRole("listitem", { name: "Workflow feature" });
    expect(feature?.textContent ?? "").toContain("não confiado");
    expect(items("Comandos de feature")).toEqual(["fd-test --all"]);
    expect(items("Erros de quebrado")).toEqual(["steps.0.id: obrigatório"]);
    expect(screen.queryByRole("button", { name: "Confiar em quebrado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confiar em feature" })).not.toBeNull();
  });

  test("confiar mostra os comandos e pede confirmação antes", async () => {
    const { board, project } = await online({ feature: FEATURE }, []);
    await click("Workflows de repo");
    await settle(() => screen.queryByRole("button", { name: "Confiar em feature" }) !== null);
    await click("Confiar em feature");
    expect(screen.queryByRole("dialog")?.textContent ?? "").toContain("fd-test --all");
    await click("Cancelar");
    expect((await board.listWorkflows(project.id))[0]?.trusted).toBe(false);
    await click("Confiar em feature");
    await click("Confirmar");
    await settle(() => screen.queryByRole("button", { name: "Confiar em feature" }) === null);
    expect((await board.listWorkflows(project.id))[0]?.trusted).toBe(true);
    const feature = screen.queryByRole("listitem", { name: "Workflow feature" });
    expect(feature?.textContent ?? "").toContain("confiado");
    expect(feature?.textContent ?? "").not.toContain("não confiado");
  });

  test("iniciar o card escolhe o workflow (só os confiados) e preenche os inputs", async () => {
    const plan =
      "inputs: [task]\nsteps:\n  - id: plan\n    agent: { prompt: 'plano de {{inputs.task}}' }\n";
    const { board, project } = await online({ plan, outro: FEATURE }, ["plan"]);
    const card = board.createCard(project.id, { title: "Somar", description: "x" });
    await click("Abrir board de repo");
    await settle(() => screen.queryByLabelText("Card Somar") !== null);
    const open = screen.queryByLabelText("Card Somar")?.querySelector("button") ?? null;
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await settle(
      () => (screen.queryByLabelText("Workflow") as HTMLSelectElement | null)?.options.length === 2,
    );
    const select = screen.queryByLabelText("Workflow") as HTMLSelectElement | null;
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      "Nenhum (card simples)",
      "plan",
    ]);
    expect(screen.queryByLabelText("Input task")).toBeNull();
    await change("Workflow", "plan");
    await change("Input task", "dois números");
    await click("Iniciar");
    await settle(() => board.getCard(card.id).workflowRunId !== null);
    const runId = board.getCard(card.id).workflowRunId ?? "";
    expect(runId).not.toBe("");
    expect(board.workflows.getRun(runId).inputs).toEqual({ task: "dois números" });
    await settle(() => screen.queryByRole("region", { name: "Execução do workflow" }) !== null);
    expect(screen.queryByRole("region", { name: "Execução do workflow" })).not.toBeNull();
  });
});
