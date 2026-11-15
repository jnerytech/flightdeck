import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../../daemon/test/support/board-helpers.ts";
import { must } from "../../../daemon/test/support/helpers.ts";
import {
  act,
  cardItem,
  cardMenu,
  click,
  column,
  createCard,
  dialog,
  fireEvent,
  fromMenu,
  menuEntries,
  menuEntry,
  openBoard,
  openCard,
  openCardMenu,
  screen,
  settle,
  setup,
  teardown,
  type,
} from "./ui-setup.tsx";

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(20_000);
afterEach(teardown);

describe("board-ui: the order of a column, the filters, finishing and discarding", () => {
  test("Mover para cima e para baixo reordenam a coluna, e ficam desligados nas pontas", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    for (const title of ["A", "B", "C"]) await createCard(title);
    const disabled = (name: string) => menuEntry(name)?.getAttribute("aria-disabled") === "true";
    await openCardMenu("A");
    expect(disabled("Mover para cima")).toBe(true);
    expect(disabled("Mover para baixo")).toBe(false);
    await act(async () => {
      fireEvent.keyDown(menuEntries()[0] as HTMLElement, { key: "Escape" });
    });
    await openCardMenu("C");
    expect(disabled("Mover para cima")).toBe(false);
    expect(disabled("Mover para baixo")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(menuEntries()[0] as HTMLElement, { key: "Escape" });
    });
    await cardMenu("B", "Mover para cima");
    await settle(() => column("Backlog")[0] === "B");
    expect(column("Backlog")).toEqual(["B", "A", "C"]);
    await cardMenu("B", "Mover para baixo");
    await settle(() => column("Backlog")[0] === "A");
    expect(column("Backlog")).toEqual(["A", "B", "C"]);
    await cardMenu("A", "Mover para baixo");
    await settle(() => column("Backlog")[0] === "B");
    expect(column("Backlog")).toEqual(["B", "A", "C"]);
    await cardMenu("A", "Mover para baixo");
    await settle(() => column("Backlog")[2] === "A");
    expect(column("Backlog")).toEqual(["B", "C", "A"]);
  });

  test("filtro por texto no título e na descrição", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Corrigir login", "tela de entrada");
    await createCard("Novo relatório", "exportar CSV do login antigo");
    await createCard("Ajustar build", "pipeline");
    await type("Filtrar cards", "LOGIN");
    expect(column("Backlog")).toEqual(["Corrigir login", "Novo relatório"]);
    await type("Filtrar cards", "pipeline");
    expect(column("Backlog")).toEqual(["Ajustar build"]);
    await type("Filtrar cards", "");
    expect(column("Backlog")).toHaveLength(3);
  });

  test("um branch escolhido na árvore da barra lateral reduz o board aos seus cards, com um chip que limpa (issue #116)", async () => {
    const { repo, store } = await setup();
    await openBoard(repo);
    await createCard("Sem worktree");
    const hostId = store.getState().hosts[0]?.id as string;
    const project = store.getState().projects[hostId]?.[0] as { id: string; path: string };
    const pick = (kind: "primary" | "worktree", path: string, branch: string) =>
      act(async () => {
        store.setWorktreeFilter({ hostId, projectId: project.id, kind, path, branch });
      });
    // The main checkout keeps the cards that have no worktree.
    await pick("primary", project.path, "main");
    await settle(() => screen.queryByText("Branch: main") !== null);
    expect(column("Backlog")).toEqual(["Sem worktree"]);
    // A worktree no card has is not there: the filter is inert, no chip and every card shows.
    await pick("worktree", "/wt/outro", "fd/outro");
    await settle(() => screen.queryByText("Branch: main") === null);
    expect(screen.queryByText("Branch: fd/outro")).toBeNull();
    expect(column("Backlog")).toEqual(["Sem worktree"]);
    await pick("primary", project.path, "main");
    await settle(() => screen.queryByText("Branch: main") !== null);
    await click("Limpar o filtro de branch");
    expect(store.getState().worktreeFilter).toBeNull();
    expect(screen.queryByText("Branch: main")).toBeNull();
    expect(column("Backlog")).toEqual(["Sem worktree"]);
  });

  test("Concluir e Descartar pedem confirmação; Descartar avisa das alterações não enviadas", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    await createCard("Terminar", "faça");
    await openCard("Terminar");
    await click("Iniciar");
    await click("Voltar ao board");
    await settle(() => column("Em revisão").includes("Terminar"));
    expect(column("Em revisão")).toEqual(["Terminar"]);

    await openCard("Terminar");
    await fromMenu("Terminar", "Finalizar…");
    await click("Concluir");
    expect(dialog()?.textContent ?? "").toContain("Concluir este card?");
    await click("Cancelar");
    expect(dialog()).toBeNull();
    const id = board.getBoard(board.listProjects()[0]?.id ?? "").columns[3]?.cards[0]?.id ?? "";
    expect(board.getCard(id).column).toBe("review");
    await fromMenu("Terminar", "Finalizar…");
    await click("Concluir");
    await click("Concluir card");
    await settle(() => board.getCard(id).worktreePath === null);
    expect(board.getCard(id)).toMatchObject({ column: "done", worktreePath: null });
    await click("Voltar ao board");
    await settle(() => column("Concluído").includes("Terminar"));
    expect(column("Concluído")).toEqual(["Terminar"]);

    await createCard("Jogar fora", "faça");
    await openCard("Jogar fora");
    await click("Iniciar");
    const discardId = board
      .getBoard(board.listProjects()[0]?.id ?? "")
      .columns.flatMap((c) => c.cards)
      .find((c) => c.title === "Jogar fora")?.id;
    await settle(() => board.getCard(discardId ?? "").sessionStatus === "idle");
    writeFileSync(
      join(must(board.getCard(discardId ?? "").worktreePath, "worktreePath"), "rascunho.txt"),
      "x\n",
    );
    await fromMenu("Jogar fora", "Descartar");
    await settle(() => (dialog()?.textContent ?? "").includes("não enviadas"));
    expect(dialog()?.textContent ?? "").toContain("Descartar este card?");
    expect(dialog()?.textContent ?? "").toContain("Há alterações não enviadas que serão perdidas.");
    await click("Cancelar");
    expect(board.getCard(discardId ?? "").id).toBe(discardId ?? "");
    await fromMenu("Jogar fora", "Descartar");
    await settle(() => dialog() !== null);
    await click("Descartar card");
    await settle(
      () =>
        cardItem("Jogar fora") === null &&
        screen.queryByRole("heading", { name: "Board de repo" }) !== null,
    );
    expect(cardItem("Jogar fora")).toBeNull();
    expect(git(repo, "branch", "--list", "fd/jogar-fora")).toBe("");
  });

  test("Descartar card sem alterações não mostra o aviso", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Ideia", "faça");
    await openCard("Ideia");
    await fromMenu("Ideia", "Descartar");
    await settle(() => dialog() !== null);
    expect(dialog()?.textContent ?? "").toContain("Descartar este card?");
    expect(dialog()?.textContent ?? "").not.toContain("não enviadas");
  });
});
