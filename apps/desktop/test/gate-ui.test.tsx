import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
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

const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLTextAreaElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLTextAreaElement, { target: { value } });
  });
};

const YAML = `steps:
  - id: plan
    agent: { prompt: plano }
  - id: approve
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "implemente: {{steps.approve.output}}" }
`;

/** The app online on a host whose card "Somar" runs the workflow up to the gate. */
async function atGate() {
  const d = await workflowDaemon(cleanups, { wf: YAML });
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const card = d.board.createCard(d.project.id, { title: "Somar", description: "x" });
  await d.board.startCard(card.id, { workflow: "wf" });
  const runId = d.board.getCard(card.id).workflowRunId ?? "";
  await settle(() => needsYou(store.getState()).length === 1);
  const run = () => d.board.workflows.getRun(runId);
  return { ...d, store, card, runId, run };
}

async function openCard() {
  await click("Projetos de alfa");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByLabelText("Card Somar") !== null);
  const open = screen.queryByLabelText("Card Somar")?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("region", { name: "Gate approve" }) !== null);
}

describe("gate-ui", () => {
  test("gate inline mostra a pergunta e o que mostrar, e aprova com nota", async () => {
    const { run } = await atGate();
    await openCard();
    const gate = screen.queryByRole("region", { name: "Gate approve" });
    expect(gate?.textContent ?? "").toContain("Aprovar o plano?");
    expect(gate?.textContent ?? "").toContain("Echo: plano");
    await type("Nota do gate", "capriche");
    await click("Aprovar");
    await settle(() => run().status === "completed");
    expect(run().steps[1]).toMatchObject({ status: "approved", note: "capriche" });
    expect(run().steps[2]?.output).toBe("Echo: implemente: capriche");
    await settle(() => screen.queryByRole("region", { name: "Gate approve" }) === null);
    expect(screen.queryByRole("region", { name: "Gate approve" })).toBeNull();
  });

  test("gate inline recusa com nota", async () => {
    const { run } = await atGate();
    await openCard();
    await type("Nota do gate", "refaça o plano");
    await click("Recusar");
    await settle(() => run().status === "rejected");
    expect(run().statusReason).toBe("gate approve recusado: refaça o plano");
  });

  test("gate aberto aparece em Precisa de você; aprovar por lá segue e tira da fila", async () => {
    const { store, run, hostId } = await atGate().then((ctx) => ({
      ...ctx,
      hostId: ctx.store.getState().hosts[0]?.id ?? "",
    }));
    const label = "alfa · Somar: gate approve";
    expect(screen.queryByRole("heading", { name: "Precisa de você (1)" })).not.toBeNull();
    expect(needsYou(store.getState())[0]).toMatchObject({
      hostId,
      sessionName: "Somar",
      toolName: "gate approve",
    });
    // The queue expands the gate: "Abrir card" opens the card; Aprovar answers from the queue.
    await click(label);
    await click("Abrir card");
    await settle(() => screen.queryByRole("region", { name: "Gate approve" }) !== null);
    expect(screen.queryByRole("heading", { name: "Somar" })).not.toBeNull();
    await click(label);
    const card = screen.queryByRole("group", { name: "Pedido de gate approve" });
    expect(card).not.toBeNull();
    const approve = card ? within(card).queryByRole("button", { name: "Aprovar" }) : null;
    expect(approve).not.toBeNull();
    await act(async () => {
      fireEvent.click(approve as HTMLElement);
    });
    await settle(() => run().status === "completed");
    expect(run().steps[1]?.status).toBe("approved");
    await settle(() => needsYou(store.getState()).length === 0);
    expect(screen.queryByRole("heading", { name: /Precisa de você/ })).toBeNull();
  });

  test("recusar pela fila encerra a execução", async () => {
    const { run } = await atGate();
    await click("alfa · Somar: gate approve");
    await click("Negar");
    await click("Negar");
    await settle(() => run().status === "rejected");
    expect(run().statusReason).toBe("gate approve recusado");
  });
});
