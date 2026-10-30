import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { installFakeCheck } from "../../../scripts/test/check-guard.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { poll } from "../../daemon/test/helpers.ts";
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

// Real git and a workflow run under the in-process daemon: more than the default 5 s.
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

const text = (label: string) => screen.queryByLabelText(label)?.textContent ?? "";

const YAML = `budget: { maxTurns: 10, maxCostUsd: 2 }
steps:
  - id: plan
    agent: { prompt: "plano [cost:0.5]" }
  - id: lint
    check: fd-lint
  - id: ok
    gate: { message: "Seguir?" }
`;

/** A card whose workflow run is waiting at the gate, with its detail open in the app. */
async function cardAtGate() {
  const fake = installFakeCheck("fd-lint", [{ args: [], stdout: "sem problemas" }]);
  cleanups.push(() => fake.restore());
  const d = await workflowDaemon(cleanups, { wf: YAML });
  const card = d.board.createCard(d.project.id, { title: "Somar", description: "x" });
  await d.board.startCard(card.id, { workflow: "wf" });
  const runId = d.board.getCard(card.id).workflowRunId ?? "";
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await settle(() => d.board.workflows.getRun(runId).status === "waiting");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByLabelText("Card Somar") !== null);
  const open = screen.queryByLabelText("Card Somar")?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("region", { name: "Execução do workflow" }) !== null);
  return { ...d, card, runId, store };
}

/** Text of each step in the timeline, top to bottom. */
const steps = () =>
  [...(screen.queryByRole("list", { name: "Etapas" })?.querySelectorAll("li") ?? [])].map(
    (li) => li.textContent ?? "",
  );

describe("run-ui", () => {
  test("linha do tempo mostra as etapas com status e tentativa, e o medidor de orçamento", async () => {
    await cardAtGate();
    expect(screen.queryByRole("heading", { name: "Workflow wf · esperando você" })).not.toBeNull();
    const shown = steps();
    expect(shown).toHaveLength(3);
    expect(shown[0] ?? "").toStartWith("plan · tentativa 1 · concluída");
    expect(shown[1] ?? "").toStartWith("lint · tentativa 1 · concluída");
    expect(shown[2] ?? "").toStartWith("ok · tentativa 1 · esperando você");
    // Usage of each agent step; checks and gates spend no turns.
    expect(shown[0] ?? "").toContain("· 1 turno · US$ 0.50");
    expect(shown[1] ?? "").not.toContain("turno");
    expect(text("Orçamento")).toContain("Turnos: 1 de 10");
    expect(text("Orçamento")).toContain("Custo estimado: US$ 0.50 de US$ 2.00");
    expect(text("Orçamento")).toContain("Minutos: 0.0 (sem limite)");
    const turns = screen.queryByRole("meter", { name: "Turnos" });
    expect(turns?.getAttribute("value")).toBe("1");
    expect(turns?.getAttribute("max")).toBe("10");
  });

  test("clicar numa etapa agent abre a conversa; numa etapa check, a saída", async () => {
    await cardAtGate();
    await click("Abrir etapa plan");
    await settle(() => text("Conversa da etapa plan").includes("Echo: plano [cost:0.5]"));
    expect(text("Conversa da etapa plan")).toContain("Echo: plano [cost:0.5]");
    await click("Abrir etapa lint");
    expect(text("Saída do check lint")).toBe("sem problemas");
    expect(screen.queryByText("código 0")).not.toBeNull();
  });

  test("a linha do tempo acompanha run.updated", async () => {
    const d = await cardAtGate();
    d.board.workflows.respond(d.runId, "ok", 1, "approve");
    await settle(() => screen.queryByRole("heading", { name: "Workflow wf · concluída" }) !== null);
    expect(screen.queryByRole("heading", { name: "Workflow wf · concluída" })).not.toBeNull();
    expect(steps()[2] ?? "").toStartWith("ok · tentativa 1 · aprovado");
  });

  test("workflow esperando a cota mostra até quando, em HH:MM", async () => {
    const quota = new Quota({ pauseAt: 0.9 });
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[tool] a' }\n  - id: b\n    agent: { prompt: b }\n";
    const d = await workflowDaemon(cleanups, { wf: yaml }, ["wf"], { quota });
    const card = d.board.createCard(d.project.id, { title: "Cota", description: "x" });
    await d.board.startCard(card.id, { workflow: "wf" });
    const runId = d.board.getCard(card.id).workflowRunId ?? "";
    const store = new AppStore(memoryPlatform().platform, {
      baseDelayMs: 60_000,
      formatTime: (iso) => new Date(iso).toISOString().slice(11, 16),
    });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const sessionId = await poll(() => d.board.workflows.getRun(runId).steps[0]?.sessionId, 3000);
    await poll(() => d.eventStore.pendingPermissions(sessionId ?? "").length > 0, 3000);
    quota.record([
      {
        window: "five_hour",
        utilization: 0.97,
        status: "allowed",
        resetsAt: Date.UTC(2030, 0, 1, 18, 45),
      },
    ]);
    const request = d.eventStore.pendingPermissions(sessionId ?? "")[0]?.id ?? "";
    d.manager.respondPermission({ requestId: request, decision: "allow" });
    await settle(() => d.board.workflows.getRun(runId).quotaUntil !== null);
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
    await click("Abrir board de repo");
    await settle(() => screen.queryByLabelText("Card Cota") !== null);
    const open = screen.queryByLabelText("Card Cota")?.querySelector("button") ?? null;
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await settle(() =>
      (screen.queryByRole("region", { name: "Execução do workflow" })?.textContent ?? "").includes(
        "cota",
      ),
    );
    expect(
      screen.queryByRole("region", { name: "Execução do workflow" })?.textContent ?? "",
    ).toContain("aguardando cota até 18:45");
  });
});
