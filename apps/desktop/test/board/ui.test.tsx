import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { git } from "../../../daemon/test/support/board-helpers.ts";
import {
  act,
  cardItem,
  cardMenu,
  click,
  column,
  createCard,
  dialog,
  drag,
  fireEvent,
  menuEntries,
  menuEntry,
  moveAnyway,
  openBoard,
  openCard,
  openCardMenu,
  screen,
  settle,
  setup,
  sidebar,
  teardown,
  type,
  within,
} from "./ui-setup.tsx";

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(20_000);
afterEach(teardown);

describe("board-ui: projects, columns, filters, drag and the card menu", () => {
  test("Projetos: cadastra o repositório, edita o projeto e ajusta o limite do host", async () => {
    const { repo, board } = await setup();
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("heading", { name: "Projetos de alfa" }) !== null);
    await type("Caminho do repositório", repo);
    await type("Nome", "Meu repo");
    await type("Branch base", "main");
    await type("Provedor de PR", "github");
    await type("Script de preparação", "echo ok");
    await type("Modelo de instruções", "Trabalhe só aqui.");
    await click("Cadastrar projeto");
    await settle(() => board.listProjects().length === 1);
    expect(board.listProjects()[0]).toMatchObject({
      name: "Meu repo",
      prProvider: "github",
      setupScript: "echo ok",
      promptTemplate: "Trabalhe só aqui.",
    });
    await settle(() => screen.queryByRole("button", { name: "Editar Meu repo" }) !== null);
    await click("Editar Meu repo");
    expect((screen.queryByLabelText("Nome") as HTMLInputElement | null)?.value).toBe("Meu repo");
    await type("Nome", "Renomeado");
    await type("Script de preparação", "");
    await click("Salvar projeto");
    await settle(() => board.listProjects()[0]?.name === "Renomeado");
    expect(board.listProjects()[0]?.setupScript).toBeNull();
    await settle(() => screen.queryByRole("button", { name: "Abrir board de Renomeado" }) !== null);
    expect(screen.queryByRole("button", { name: "Abrir board de Renomeado" })).not.toBeNull();
    expect(
      (screen.queryByLabelText("Execuções em paralelo") as HTMLInputElement | null)?.value,
    ).toBe("2");
    await type("Execuções em paralelo", "3");
    await click("Salvar limite");
    await settle(() => board.maxParallelRuns === 3);
    expect(board.maxParallelRuns).toBe(3);
  });

  test("uma coluna vazia oferece Adicionar card, que abre o formulário do card novo", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    const region = screen.queryByRole("region", { name: "Em andamento" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(within(region).getByRole("button", { name: "Vazio, Adicionar card" }));
    });
    expect(screen.queryByLabelText("Título do card")).not.toBeNull();
  });

  test("cada coluna mostra o ícone, a contagem em pílula e um + que cria o card nela", async () => {
    const { repo, store } = await setup();
    await openBoard(repo);
    for (const title of ["A", "B"]) await createCard(title);
    const count = (name: string) =>
      screen.getByRole("region", { name }).querySelector(".column-count")?.textContent;
    expect(count("Backlog")).toBe("2");
    expect(count("Concluído")).toBe("0");
    for (const name of ["Backlog", "Em andamento", "Precisa de você", "Em revisão", "Concluído"]) {
      expect(
        screen.getByRole("region", { name }).querySelector("[data-slot='column-icon']"),
      ).not.toBeNull();
    }
    const sent: Array<[string, unknown]> = [];
    const send = store.hostCommand.bind(store) as (...a: unknown[]) => Promise<unknown>;
    store.hostCommand = ((host: string, type: string, payload: unknown) => {
      sent.push([type, payload]);
      return send(host, type, payload);
    }) as never;
    await click("Adicionar card em Em revisão");
    await type("Título do card", "Direto na revisão");
    await click("Criar card");
    await settle(() => column("Em revisão").includes("Direto na revisão"));
    expect(column("Em revisão")).toEqual(["Direto na revisão"]);
    // One command that says the column, not a create followed by a move that could fail or race.
    expect(sent.filter(([type]) => type === "card.create")).toMatchObject([
      ["card.create", { column: "review" }],
    ]);
    expect(sent.some(([type]) => type === "card.move")).toBe(false);
    expect(column("Backlog")).toEqual(["A", "B"]);
    expect(count("Em revisão")).toBe("1");
  });

  test("uma coluna vazia mostra um botão que diz Vazio e se chama Adicionar card", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    const done = screen.getByRole("region", { name: "Concluído" });
    // WCAG 2.5.3: the name a voice user says starts with the word they see.
    const empty = within(done).queryByRole("button", { name: "Vazio, Adicionar card" });
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe("Vazio");
  });

  // #114 (board, Orca's lane): a filter's "no matches" was a bare line under an empty list. The lane
  // says it in a box under its head. The lane's border, the head's line and the box's height are
  // computed styles: the e2e `layout-medido` journey measures them in the browser (#1870).
  test("a filter that matches nothing says so in the lane and hides its card, and clearing it brings the card back", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Corrigir login");
    const lane = (name: string) => screen.queryByRole("region", { name }) as HTMLElement;
    await type("Filtrar cards", "nada disso");
    const filtered = {
      noMatch: within(lane("Backlog")).queryByText("Nenhuma correspondência") !== null,
      card: cardItem("Corrigir login") !== null,
    };
    await type("Filtrar cards", "");
    expect({
      filtered,
      cleared: {
        noMatch: within(lane("Backlog")).queryByText("Nenhuma correspondência") !== null,
        card: cardItem("Corrigir login") !== null,
      },
    }).toEqual({
      filtered: { noMatch: true, card: false },
      cleared: { noMatch: false, card: true },
    });
  });

  test("arrastar entre colunas move o card; soltar sobre outro card reordena a coluna", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    for (const title of ["A", "B", "C"]) await createCard(title);
    expect(column("Backlog")).toEqual(["A", "B", "C"]);
    for (const label of ["Em andamento", "Precisa de você", "Em revisão", "Concluído"]) {
      expect(screen.queryByRole("region", { name: label })).not.toBeNull();
    }
    await drag("C", cardItem("A"));
    await settle(() => column("Backlog")[0] === "C");
    expect(column("Backlog")).toEqual(["C", "A", "B"]);
    await drag("B", cardItem("A"));
    await settle(() => column("Backlog")[1] === "B");
    expect(column("Backlog")).toEqual(["C", "B", "A"]);
    await drag("A", screen.queryByRole("region", { name: "Em revisão" }));
    await moveAnyway();
    await settle(() => column("Em revisão").length === 1);
    expect(column("Em revisão")).toEqual(["A"]);
    expect(column("Backlog")).toEqual(["C", "B"]);
    const moved = board.listProjects()[0];
    expect(board.getBoard(moved?.id ?? "").columns[3]?.cards.map((c) => c.title)).toEqual(["A"]);
    // A column looks different while a card is over it and goes back when the card leaves.
    const over = screen.queryByRole("region", { name: "Em andamento" }) as HTMLElement;
    const resting = over.className;
    await act(async () => {
      fireEvent.dragEnter(over);
    });
    expect(over.className).not.toBe(resting);
    await act(async () => {
      fireEvent.dragLeave(over);
    });
    expect(over.className).toBe(resting);
    // Dropping without dragging anything does nothing.
    await act(async () => {
      fireEvent.drop(screen.queryByRole("region", { name: "Concluído" }) as HTMLElement);
    });
    expect(column("Concluído")).toEqual([]);
  });

  test("o menu do card move o card para outra coluna sem arrastar, e o foco fica no card", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    for (const title of ["A", "B"]) await createCard(title);
    await openCardMenu("A");
    expect(menuEntries().map((m) => m.textContent)).toEqual([
      "Iniciar card",
      "Selecionar card",
      "Mover para Em andamento",
      "Mover para Precisa de você",
      "Mover para Em revisão",
      "Mover para Concluído",
      "Mover para cima",
      "Mover para baixo",
      "Editar…",
      "Excluir…",
    ]);
    await act(async () => {
      fireEvent.click(menuEntry("Mover para Em revisão") as HTMLElement);
    });
    await moveAnyway();
    await settle(() => column("Em revisão").length === 1);
    expect(column("Em revisão")).toEqual(["A"]);
    expect(column("Backlog")).toEqual(["B"]);
    const moved = board.listProjects()[0];
    expect(board.getBoard(moved?.id ?? "").columns[3]?.cards.map((c) => c.title)).toEqual(["A"]);
    await settle(() => cardItem("A")?.contains(document.activeElement) === true);
    expect(cardItem("A")?.contains(document.activeElement)).toBe(true);
    expect(
      screen.queryByRole("region", { name: "Em revisão" })?.contains(document.activeElement),
    ).toBe(true);
  });

  test("Editar… abre o card com o título pronto para editar, e Salvar título grava", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    await createCard("Ideia velha", "d");
    await cardMenu("Ideia velha", "Editar…");
    await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
    const field = screen.queryByLabelText("Título") as HTMLInputElement | null;
    expect(field?.value).toBe("Ideia velha");
    expect(document.activeElement).toBe(field);
    await type("Título", "Ideia nova");
    await click("Salvar título");
    const id = board.getBoard(board.listProjects()[0]?.id ?? "").columns[0]?.cards[0]?.id ?? "";
    await settle(() => board.getCard(id).title === "Ideia nova");
    expect(board.getCard(id).title).toBe("Ideia nova");
  });

  test("Excluir… cita o card, Cancelar o mantém e Excluir card o remove do board", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    await createCard("Sobrando", "d");
    await cardMenu("Sobrando", "Excluir…");
    expect(dialog()?.textContent ?? "").toContain("Sobrando");
    await click("Cancelar");
    expect(dialog()).toBeNull();
    expect(cardItem("Sobrando")).not.toBeNull();
    await cardMenu("Sobrando", "Excluir…");
    await click("Excluir card");
    await settle(() => cardItem("Sobrando") === null);
    expect(cardItem("Sobrando")).toBeNull();
    expect(board.getBoard(board.listProjects()[0]?.id ?? "").columns[0]?.cards).toEqual([]);
  });

  test("Excluir… de um card que já começou explica a recusa e oferece Descartar card no lugar", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    await createCard("Em curso", "faça");
    await openCard("Em curso");
    await click("Iniciar");
    await click("Voltar ao board");
    await settle(() => column("Em revisão").includes("Em curso"));
    await cardMenu("Em curso", "Excluir…");
    expect(dialog()?.textContent ?? "").toContain("já começou");
    expect(screen.queryByRole("button", { name: "Excluir card" })).toBeNull();
    await click("Descartar card");
    await settle(() => cardItem("Em curso") === null);
    expect(git(repo, "branch", "--list", "fd/em-curso")).toBe("");
    expect(board.listProjects()).toHaveLength(1);
  });
});
