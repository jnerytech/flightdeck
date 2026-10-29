import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
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
  await click("Projetos de alfa");
  await type("Caminho do repositório", repo);
  await type("Modelo de instruções", "");
  await click("Cadastrar projeto");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByRole("heading", { name: "Board de repo" }) !== null);
}

async function createCard(title: string, description = "faça") {
  await type("Título do card", title);
  await type("Descrição do card", description);
  await click("Criar card");
  await settle(() => cardItem(title) !== null);
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

const dialog = () => screen.queryByRole("dialog");

describe("board-ui", () => {
  test("Projetos: cadastra o repositório, edita o projeto e ajusta o limite do host", async () => {
    const { repo, board } = await setup();
    await click("Projetos de alfa");
    expect(screen.queryByRole("heading", { name: "Projetos de alfa" })).not.toBeNull();
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
    await settle(() => column("Em revisão").length === 1);
    expect(column("Em revisão")).toEqual(["A"]);
    expect(column("Backlog")).toEqual(["C", "B"]);
    const moved = board.listProjects()[0];
    expect(board.getBoard(moved?.id ?? "").columns[3]?.cards.map((c) => c.title)).toEqual(["A"]);
    // Dropping without dragging anything does nothing.
    await act(async () => {
      fireEvent.drop(screen.queryByRole("region", { name: "Concluído" }) as HTMLElement);
    });
    expect(column("Concluído")).toEqual([]);
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
    await click("Concluir");
    expect(dialog()?.textContent ?? "").toContain("Concluir este card?");
    await click("Cancelar");
    expect(dialog()).toBeNull();
    const id = board.getBoard(board.listProjects()[0]?.id ?? "").columns[3]?.cards[0]?.id ?? "";
    expect(board.getCard(id).column).toBe("review");
    await click("Concluir");
    await click("Confirmar");
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
    writeFileSync(join(board.getCard(discardId ?? "").worktreePath ?? "", "rascunho.txt"), "x\n");
    await click("Descartar");
    await settle(() => (dialog()?.textContent ?? "").includes("não enviadas"));
    expect(dialog()?.textContent ?? "").toContain("Descartar este card?");
    expect(dialog()?.textContent ?? "").toContain("Há alterações não enviadas que serão perdidas.");
    await click("Cancelar");
    expect(board.getCard(discardId ?? "").id).toBe(discardId ?? "");
    await click("Descartar");
    await settle(() => dialog() !== null);
    await click("Confirmar");
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
    await click("Descartar");
    await settle(() => dialog() !== null);
    expect(dialog()?.textContent ?? "").toContain("Descartar este card?");
    expect(dialog()?.textContent ?? "").not.toContain("não enviadas");
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
    expect(cardItem("Detalhe")).toBeNull();

    await type("Ajuste", "mais um [commit]");
    await click("Pedir ajuste");
    await settle(() => (screen.queryByRole("log")?.textContent ?? "").includes("mais um [commit]"));
    expect(screen.queryByRole("log")?.textContent ?? "").toContain("mais um [commit]");
    await settle(() => board.getCard(id).sessionStatus === "idle");
    await click("Parar");

    writeFileSync(join(board.getCard(id).worktreePath ?? "", "solto.txt"), "não commitado\n");
    await click("Diff");
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

    // No PR provider: the daemon refuses and the banner says why.
    await click("Abrir PR");
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("projeto sem provedor de PR");
    await click("Conversa");
    expect(screen.queryByRole("log")).not.toBeNull();
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
    expect(cardItem("Ocupa")?.textContent ?? "").toContain("esperando você");
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
  });
});
