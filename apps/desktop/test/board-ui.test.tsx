import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { must } from "../../daemon/test/helpers.ts";
import { chooseFromCardMenu } from "./card-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** Finalizar… and Descartar sit under the card's menu (#1197). */
const fromMenu = (title: string, item: string) =>
  chooseFromCardMenu({ act, fireEvent, screen } as never, `Ações de ${title}`, item);
const click = async (name: string | RegExp) => {
  // The session's views are tabs; everything else is a button.
  const button = screen.queryByRole("button", { name }) ?? screen.queryByRole("tab", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** Titles of the cards in a column, top to bottom. */
const column = (label: string) =>
  [...(screen.queryByRole("region", { name: label })?.querySelectorAll("li[draggable]") ?? [])].map(
    (li) => (li.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );

const cardItem = (title: string) => screen.queryByLabelText(`Card ${title}`);

/** One host with a git repository inside its allowed root, already online. */
async function setup() {
  const d = makeDaemon(cleanups);
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { ...d, repo, store };
}

/** Registers the repo through the Projects screen and opens its board. */
async function openBoard(repo: string) {
  await sidebar.hostAction("Projetos", "alfa");
  await type("Caminho do repositório", repo);
  await type("Modelo de instruções", "");
  await click("Cadastrar projeto");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByRole("heading", { name: "Board de repo" }) !== null);
}

async function createCard(title: string, description = "faça") {
  // The form lives in a dialog the "Novo card" button opens.
  await click("Novo card");
  await type("Título do card", title);
  await type("Descrição do card", description);
  await click("Criar card");
  await settle(() => cardItem(title) !== null);
}

/** Em revisão asks for a PR before a card goes there (#78): these cards have none, so go on anyway. */
async function moveAnyway() {
  const ask = await screen.findByRole("alertdialog");
  expect(ask.textContent).toContain("ainda precisa de um link de PR");
  await act(async () => {
    fireEvent.click(within(ask).getByRole("button", { name: "Mover mesmo assim" }));
  });
}

async function drag(title: string, target: HTMLElement | null) {
  const item = cardItem(title);
  expect(item).not.toBeNull();
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.dragStart(item as HTMLElement);
    fireEvent.dragOver(target as HTMLElement);
    fireEvent.drop(target as HTMLElement);
  });
}

async function openCard(title: string) {
  const open = cardItem(title)?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
}

/** A Radix menu opens on pointer down; its entries are then read or clicked. */
async function openCardMenu(title: string) {
  const trigger = screen.queryByRole("button", { name: `Ações de ${title}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(trigger as HTMLElement);
  });
}

const menuEntries = () => screen.queryAllByRole("menuitem");
const menuEntry = (name: string) => screen.queryByRole("menuitem", { name });

async function cardMenu(title: string, entry: string) {
  await openCardMenu(title);
  const item = menuEntry(entry);
  expect(item).not.toBeNull();
  await act(async () => {
    fireEvent.click(item as HTMLElement);
  });
}

const dialog = () => screen.queryByRole("alertdialog");

describe("board-ui", () => {
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
    for (const name of ["Backlog", "Em andamento", "Esperando você", "Em revisão", "Concluído"]) {
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

  test("uma coluna vazia mostra uma caixa tracejada e quieta que diz Vazio", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    const done = screen.getByRole("region", { name: "Concluído" });
    // WCAG 2.5.3: the name a voice user says starts with the word they see.
    const empty = within(done).queryByRole("button", { name: "Vazio, Adicionar card" });
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe("Vazio");
    expect(empty?.className).toContain("border-dashed");
  });

  // #114 (board, Orca's lane): since the cards' list fills the lane (#713), an empty lane put its
  // Empty box at the bottom and a filter's "no matches" was a bare line under it. Now the box sits
  // under the head and "no matches" is a quiet box there too. The lane has a border, and its head
  // a line under it.
  test("an empty lane's box sits under its head, and no matches is a box there too", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Corrigir login");
    const lane = (name: string) => screen.queryByRole("region", { name }) as HTMLElement;
    const list = lane("Concluído")?.querySelector("ul");
    const before = {
      emptyListHidden:
        list !== null && list?.children.length === 0 && list.className.includes("empty:hidden"),
    };
    await type("Filtrar cards", "nada disso");
    const noMatch = within(lane("Backlog")).queryByText("Nenhuma correspondência");
    const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    const rule = (head: string) => {
      const at = css.indexOf(head);
      return at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
    };
    expect({
      ...before,
      noMatchBox: noMatch?.classList.contains("column-empty") ?? false,
      laneBorder: /\n {2}border: 1px solid var\(--border\);/.test(rule("@utility board-column {")),
      headLine: /border-bottom: 1px solid/.test(rule("@utility column-head {")),
      boxHeight: /min-height: 5rem;/.test(rule("@utility column-empty {")),
    }).toEqual({
      emptyListHidden: true,
      noMatchBox: true,
      laneBorder: true,
      headLine: true,
      boxHeight: true,
    });
  });

  test("arrastar entre colunas move o card; soltar sobre outro card reordena a coluna", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    for (const title of ["A", "B", "C"]) await createCard(title);
    expect(column("Backlog")).toEqual(["A", "B", "C"]);
    for (const label of ["Em andamento", "Esperando você", "Em revisão", "Concluído"]) {
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
    // A column lights up while a card is over it and goes back when the card leaves or drops.
    const over = screen.queryByRole("region", { name: "Em andamento" }) as HTMLElement;
    await act(async () => {
      fireEvent.dragEnter(over);
    });
    expect(over.className).toContain("drop-over");
    await act(async () => {
      fireEvent.dragLeave(over);
    });
    expect(over.className).not.toContain("drop-over");
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
      "Mover para Esperando você",
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

  // #249: once the card's conversation shows, the page fills its pane. What was typed and not sent
  // in the card's fields stays: the body is not mounted again.
  test("what was typed in the card's title and adjustment stays when the card's session starts", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Rascunho", "faça");
    await openCard("Rascunho");
    await type("Título", "Rascunho meu");
    await type("Ajuste", "meu ajuste");
    await click("Iniciar");
    await settle(() => screen.queryByRole("log", { name: "Conversa do card" }) !== null);
    const value = (label: string) =>
      (screen.queryByLabelText(label) as HTMLInputElement | null)?.value;
    expect([value("Título"), value("Ajuste")]).toEqual(["Rascunho meu", "meu ajuste"]);
  });

  // #641, narrow-window guard ("card"): the conversation's timeline scrolled inside a page body
  // that scrolled too. Once the conversation shows, the card's details are a pane of their own
  // above it, which scrolls by itself, so the page body never does. The same element, so what was
  // typed stays (#249).
  test("once the card's conversation shows, its details become a pane of their own above it", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Painel", "faça");
    await openCard("Painel");
    const details = () => screen.queryByLabelText("Título")?.closest("[data-slot='card-info']");
    const before = details() ?? null;
    const splitBefore = before?.getAttribute("data-split") ?? null;
    await click("Iniciar");
    await settle(() => screen.queryByRole("log", { name: "Conversa do card" }) !== null);
    const after = details() ?? null;
    const log = screen.queryByRole("log", { name: "Conversa do card" });
    const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    const at = css.indexOf("@utility card-info {");
    const rule = at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
    expect({
      splitBefore,
      same: before !== null && before === after,
      splitAfter: after?.getAttribute("data-split") ?? null,
      apart: log !== null && log.closest("[data-slot='card-info']") === null,
      reachable: after?.getAttribute("tabindex") ?? null,
      scrolls: /&\[data-split="true"\] \{[^}]*overflow-y: auto/.test(rule),
    }).toEqual({
      splitBefore: "false",
      same: true,
      splitAfter: "true",
      apart: true,
      reachable: "0",
      scrolls: true,
    });
  });

  // #641: the board's columns scrolled sideways inside the page's own scroller, and their
  // scrollbar sat under the tallest column, below the window. The board fills the page now: the
  // columns row takes the rest of the height and is the sideways scroller at the window's bottom,
  // and each column's cards scroll by themselves. A narrow board snaps one column at a time.
  test("the board fills its page: the columns row scrolls sideways, each column's cards scroll by themselves", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Coluna", "faça");
    const row = document.querySelector("[data-slot='board-columns']");
    const body = row?.closest("[data-slot='page-body']");
    const lists = [
      ...document.querySelectorAll("[data-slot='board-columns'] section[data-column] > ul"),
    ];
    const classes = (el: Element | null | undefined) => el?.className.split(/\s+/) ?? [];
    expect({
      fill:
        body !== null && body !== undefined && body.closest("[data-slot='scroll-area']") === null,
      // A 12 rem floor: an empty board's notice above never squeezes the columns to nothing.
      row: ["min-h-48", "flex-1", "@max-[40rem]:snap-x", "@max-[40rem]:snap-mandatory"].filter(
        (c) => !classes(row).includes(c),
      ),
      lists: lists.length,
      scroll: lists.filter(
        (ul) => !["min-h-0", "flex-1", "overflow-y-auto"].every((c) => classes(ul).includes(c)),
      ).length,
      snap: [
        ...document.querySelectorAll("[data-slot='board-columns'] section[data-column]"),
      ].filter((column) => !classes(column).includes("snap-start")).length,
    }).toEqual({ fill: true, row: [], lists: 5, scroll: 0, snap: 0 });
  });

  test("detalhe: descrição editável, execuções, conversa, ajuste, diff lado a lado ou unificado", async () => {
    const { repo, board } = await setup();
    await openBoard(repo);
    await createCard("Detalhe", "crie [commit]");
    await openCard("Detalhe");
    expect(screen.queryByText("Sem sessão ainda.")).not.toBeNull();
    await type("Descrição", "crie e commite [commit]");
    await click("Salvar descrição");
    const id = board.getBoard(board.listProjects()[0]?.id ?? "").columns[0]?.cards[0]?.id ?? "";
    await settle(() => board.getCard(id).description === "crie e commite [commit]");
    expect(board.getCard(id).description).toBe("crie e commite [commit]");

    await click("Iniciar");
    await settle(() => board.getCard(id).sessionStatus === "idle");
    await settle(
      () => (screen.queryByRole("list", { name: "Execuções" })?.textContent ?? "") !== "",
    );
    expect(screen.queryByRole("list", { name: "Execuções" })?.textContent ?? "").toContain("#1");
    await settle(() => (screen.queryByRole("log")?.textContent ?? "").includes("Echo:"));
    expect(screen.queryByRole("log")?.textContent ?? "").toContain("crie e commite [commit]");
    // The card's conversation fills its pane like the session screen: no fixed box, no narrow column.
    const chat = screen.queryByRole("log", { name: "Conversa do card" }) as HTMLElement;
    expect(chat.className).toContain("card-chat");
    expect(chat.className).not.toContain("h-[32rem]");
    expect(chat.closest(".max-w-4xl")).toBeNull();
    expect(cardItem("Detalhe")).toBeNull();

    await type("Ajuste", "mais um [commit]");
    await click("Pedir ajuste");
    await settle(() => (screen.queryByRole("log")?.textContent ?? "").includes("mais um [commit]"));
    expect(screen.queryByRole("log")?.textContent ?? "").toContain("mais um [commit]");
    await settle(() => board.getCard(id).sessionStatus === "idle");
    // "Parar" goes away once the screen shows the session idle: the card leads with Revisar mudanças (#1197).
    await settle(() => screen.queryAllByRole("button", { name: "Parar" }).length === 0);
    expect(screen.queryByRole("button", { name: "Revisar mudanças" })).not.toBeNull();

    writeFileSync(
      join(must(board.getCard(id).worktreePath, "worktreePath"), "solto.txt"),
      "não commitado\n",
    );
    await click("Mudanças");
    await settle(() => screen.queryByRole("list", { name: "Arquivos alterados" }) !== null);
    const files = screen.queryByRole("list", { name: "Arquivos alterados" })?.textContent ?? "";
    expect(files).toContain("fake-1.txt");
    expect(files).toContain("fake-2.txt");
    expect(files).toContain("solto.txt");
    expect(files).toContain("+1 −0");
    expect(files).toContain("não commitado");
    expect(screen.queryByRole("region", { name: "Diff unificado" })?.textContent ?? "").toContain(
      "+mais um [commit]",
    );
    await click("Lado a lado");
    expect(screen.queryByRole("region", { name: "Diff lado a lado" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Diff unificado" })).toBeNull();
    await click("Unificada");
    expect(screen.queryByRole("region", { name: "Diff unificado" })).not.toBeNull();

    // No PR provider: the daemon refuses with a reason, and the toast says it in the app's language.
    await click("Abrir PR");
    await settle(() => screen.queryByRole("alert") !== null);
    const toast = screen.queryByRole("alert") as HTMLElement;
    expect(toast.textContent ?? "").toContain("O projeto não tem provedor de PR.");
    await click("Conversa");
    expect(screen.queryByRole("log")).not.toBeNull();
  });

  test("remover o host tira os cards dele do app", async () => {
    const { repo, store } = await setup();
    await openBoard(repo);
    await createCard("Some junto", "faça");
    expect(Object.keys(store.getState().cards)).toHaveLength(1);
    await act(async () => {
      await store.removeHost(store.getState().hosts[0]?.id ?? "");
    });
    expect(store.getState().cards).toEqual({});
  });

  test("cards mostram fila, estado do PR, checks e avisos vindos do daemon", async () => {
    const { repo, board, eventStore } = await setup();
    await openBoard(repo);
    await createCard("Com selos", "faça");
    const project = board.listProjects()[0]?.id ?? "";
    const id = board.getBoard(project).columns[0]?.cards[0]?.id ?? "";
    board.setMaxParallelRuns(1);
    await createCard("Ocupa", "[tool]");
    const busy = board.getBoard(project).columns[0]?.cards.find((c) => c.title === "Ocupa");
    await board.startCard(busy?.id ?? "");
    await settle(() => board.getCard(busy?.id ?? "").sessionStatus === "awaiting_permission");
    await board.startCard(id);
    await settle(() => (cardItem("Com selos")?.textContent ?? "").includes("na fila"));
    expect(cardItem("Com selos")?.textContent ?? "").toContain("na fila");
    // The session's state is the dot before the title; the line under it says the card's branch.
    const busyTile = cardItem("Ocupa") as HTMLElement;
    expect(within(busyTile).queryByRole("img", { name: "esperando você" })).not.toBeNull();
    expect(busyTile.querySelector("[data-slot='card-meta']")?.textContent ?? "").toMatch(
      /fd\/ocupa/,
    );
    await board.stopCard(id);
    eventStore.db
      .query(
        "UPDATE cards SET pr_url = 'u', pr_state = 'open', checks_state = 'failing', notice = 'algo deu errado' WHERE id = ?",
      )
      .run(id);
    board.updateCard(id, { title: "Com selos" });
    await settle(() => (cardItem("Com selos")?.textContent ?? "").includes("PR aberto"));
    const text = cardItem("Com selos")?.textContent ?? "";
    expect(text).toContain("PR aberto");
    expect(text).toContain("checks falhando");
    expect(text).toContain("algo deu errado");
    // The card's own page says the same in its header.
    await click("Com selos");
    await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
    const header = document.body.textContent ?? "";
    expect(header).toContain("PR aberto");
    expect(header).toContain("checks falhando");
  });
});
