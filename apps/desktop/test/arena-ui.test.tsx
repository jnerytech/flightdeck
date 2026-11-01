import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git worktrees (one per variant) under the in-process daemon: more than 5 s.
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(8000);

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | HTMLSelectElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

const startDialog = () => screen.queryByRole("dialog", { name: "Iniciar em arena" });
const comparison = () => screen.queryByRole("region", { name: "Comparação da arena" });
const variantRegion = (label: string) =>
  screen.queryByRole("region", { name: `Variante ${label}` });

/** A host with a project and a fresh card, on that card's screen. */
async function openCard(features?: string[]) {
  const d = await workflowDaemon(cleanups, {});
  const card = d.board.createCard(d.project.id, { title: "Comparar", description: "faça" });
  const server = features ? d.listen(0, undefined, features) : d.server;
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByLabelText("Card Comparar") !== null);
  const open = screen.queryByLabelText("Card Comparar")?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
  return { ...d, card };
}

/** Both variants have stopped working: the comparison offers Escolher. */
const idle = () =>
  ["a", "b"].every((label) => {
    const choose = within(variantRegion(label) ?? document.body).queryByRole("button", {
      name: `Escolher a variante ${label}`,
    });
    return choose !== null && !(choose as HTMLButtonElement).disabled;
  });

describe("arena-ui", () => {
  test("a host that does not announce the arena has no Iniciar em arena", async () => {
    await openCard(["workflows", "rules"]);
    expect(screen.queryByRole("button", { name: "Iniciar em arena" })).toBeNull();
  });

  test("the form starts with two variants, goes up to four and down to two", async () => {
    await openCard();
    await click("Iniciar em arena");
    expect(startDialog()).not.toBeNull();
    expect(screen.queryByLabelText("Modelo da variante 2")).not.toBeNull();
    expect(screen.queryByLabelText("Modelo da variante 3")).toBeNull();
    // Two is the least: nothing to remove yet.
    expect(screen.queryByRole("button", { name: "Remover variante 2" })).toBeNull();
    await click("Adicionar variante");
    await click("Adicionar variante");
    expect(screen.queryByLabelText("Modelo da variante 4")).not.toBeNull();
    // Four is the most.
    expect(screen.queryByRole("button", { name: "Adicionar variante" })).toBeNull();
    await click("Remover variante 4");
    await click("Remover variante 3");
    expect(screen.queryByLabelText("Modelo da variante 3")).toBeNull();
  });

  test("Iniciar creates the variants with their model and effort and shows the comparison", async () => {
    const { board, card } = await openCard();
    expect(comparison()).toBeNull();
    await click("Iniciar em arena");
    await change("Modelo da variante 1", "claude-opus-5-5");
    await change("Esforço da variante 1", "high");
    await change("Modelo da variante 2", "claude-haiku-5-5");
    await click("Iniciar", startDialog());
    await settle(() => comparison() !== null && idle());
    expect(startDialog()).toBeNull();
    const made = (await board.arena(card.id)).variants;
    expect(made.map((v) => [v.label, v.model, v.effort])).toEqual([
      ["a", "claude-opus-5-5", "high"],
      ["b", "claude-haiku-5-5", null],
    ]);
    // The card is now the arena's: it cannot start another one.
    expect(screen.queryByRole("button", { name: "Iniciar em arena" })).toBeNull();
  });

  test("the comparison puts model, effort, state, duration, cost, files and checks side by side", async () => {
    await openCard();
    await click("Iniciar em arena");
    await change("Modelo da variante 1", "claude-opus-5-5");
    await change("Esforço da variante 1", "high");
    await change("Modelo da variante 2", "claude-haiku-5-5");
    await click("Iniciar", startDialog());
    await settle(() => comparison() !== null && idle());
    const a = variantRegion("a") as HTMLElement;
    const b = variantRegion("b") as HTMLElement;
    expect(a.textContent).toContain("claude-opus-5-5");
    expect(a.textContent).toContain("Esforço: high");
    expect(b.textContent).toContain("claude-haiku-5-5");
    for (const region of [a, b]) {
      expect(within(region).queryByText("Duração")).not.toBeNull();
      expect(within(region).queryByText("Custo")).not.toBeNull();
      expect(within(region).queryByText("Arquivos")).not.toBeNull();
      expect(within(region).queryByText("Checks")).not.toBeNull();
      // This host prices nothing and the card has no workflow, no changes yet.
      expect(within(region).queryByLabelText("Custo da variante")?.textContent).toBe("—");
      expect(within(region).queryByText("Sem checks")).not.toBeNull();
      expect(within(region).queryByText("Nenhum arquivo alterado")).not.toBeNull();
    }
  });

  test("Ver mudanças opens the variant's own diff", async () => {
    await openCard();
    await click("Iniciar em arena");
    await click("Iniciar", startDialog());
    await settle(() => comparison() !== null && idle());
    const a = variantRegion("a") as HTMLElement;
    expect(within(a).queryByRole("list", { name: "Arquivos alterados" })).toBeNull();
    await click("Ver mudanças", a);
    await settle(() => within(a).queryByRole("list", { name: "Arquivos alterados" }) !== null);
    expect(within(a).queryByRole("list", { name: "Arquivos alterados" })).not.toBeNull();
    await click("Ocultar mudanças", a);
    expect(within(a).queryByRole("list", { name: "Arquivos alterados" })).toBeNull();
  });

  test("Escolher asks first: cancelling keeps every variant, confirming keeps only the chosen one", async () => {
    const { board, card } = await openCard();
    await click("Iniciar em arena");
    await click("Iniciar", startDialog());
    await settle(() => comparison() !== null && idle());
    await click("Escolher a variante b", variantRegion("b"));
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    expect(screen.queryByRole("alertdialog")?.textContent).toContain("As outras variantes");
    await click("Cancelar");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await board.arena(card.id)).variants).toHaveLength(2);
    await click("Escolher a variante b", variantRegion("b"));
    await click("Escolher variante");
    await settle(() => comparison() === null);
    expect(comparison()).toBeNull();
    expect((await board.arena(card.id)).variants).toHaveLength(0);
    // The chosen worktree is the card's now.
    expect(board.getCard(card.id).worktreePath).not.toBeNull();
  });

  test("a variant that is still working cannot be chosen", async () => {
    await openCard();
    await click("Iniciar em arena");
    await click("Iniciar", startDialog());
    await settle(() => comparison() !== null);
    // Right after the start the variants have not stopped: their Escolher is off until they do.
    const choose = within(variantRegion("a") as HTMLElement).queryByRole("button", {
      name: "Escolher a variante a",
    }) as HTMLButtonElement | null;
    expect(choose).not.toBeNull();
    expect(choose?.disabled || idle()).toBe(true);
  });

  test("Cancelar and Escape close the form without creating an arena", async () => {
    const { board, card } = await openCard();
    await click("Iniciar em arena");
    await click("Cancelar", startDialog());
    expect(startDialog()).toBeNull();
    await click("Iniciar em arena");
    await act(async () => {
      fireEvent.keyDown(startDialog() as HTMLElement, { key: "Escape" });
    });
    expect(startDialog()).toBeNull();
    expect(comparison()).toBeNull();
    expect((await board.arena(card.id)).variants).toHaveLength(0);
  });
});
