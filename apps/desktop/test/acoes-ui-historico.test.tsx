import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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

// Real git and real processes under the in-process daemon: more than the default 5 s.
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

const row = (name: string) => screen.queryByRole("listitem", { name: `Ação ${name}` });
const runs = () => screen.queryByRole("list", { name: "Execuções de teste" });

/** A host with one action that prints a masked secret and fails, run twice by different askers. */
async function online() {
  const d = await workflowDaemon(cleanups, {}, [], { actions: true });
  const actions = d.actions;
  if (!actions) throw new Error("o daemon de teste não tem as ações");
  await actions.save({
    projectId: d.project.id,
    definition: {
      name: "teste",
      description: "imprime e falha",
      run: [process.execPath, "-e", "console.log('•••(token)'); process.exit(3)"],
    },
  });
  await actions.run({ projectId: d.project.id, name: "teste", requestedBy: "claude" });
  await actions.run({ projectId: d.project.id, name: "teste", requestedBy: "you" });
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
  await click("Ações de repo");
  await settle(() => row("teste") !== null);
  return d;
}

describe("acoes-ui-historico: as execuções de uma ação", () => {
  test("Execuções abre o histórico, o mais novo primeiro, com quem pediu, o código, a duração e a saída como chegou", async () => {
    await online();
    expect(runs()).toBeNull();
    await click("Execuções de teste", row("teste"));
    await settle(() => runs()?.children.length === 2);
    const [newest, oldest] = [...(runs()?.children ?? [])].map((li) => li.textContent ?? "");
    expect(newest).toContain("Você");
    expect(oldest).toContain("Claude");
    for (const text of [newest, oldest]) {
      expect(text).toContain("código 3");
      expect(text).toContain("•••(token)");
    }
    await click("Ocultar execuções de teste", row("teste"));
    expect(runs()).toBeNull();
  });

  test("uma ação que nunca rodou diz isso", async () => {
    const d = await online();
    await act(async () => {
      await d.actions?.save({
        projectId: d.project.id,
        definition: { name: "nova", description: "nunca rodou", run: ["echo", "x"] },
      });
    });
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
    await click("Ações de repo");
    await settle(() => row("nova") !== null);
    await click("Execuções de nova", row("nova"));
    await settle(() => screen.queryByText("Nenhuma execução ainda") !== null);
    expect(screen.queryByText("Nenhuma execução ainda")).not.toBeNull();
  });
});
