import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { must } from "../../../daemon/test/support/helpers.ts";
import {
  act,
  cardItem,
  click,
  createCard,
  openBoard,
  openCard,
  screen,
  settle,
  setup,
  teardown,
  type,
  within,
} from "./ui-setup.tsx";

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(20_000);
afterEach(teardown);

describe("board-ui: the card detail, the page and the host", () => {
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
    await settle(() => screen.queryByRole("region", { name: "Conversa do card" }) !== null);
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
    await settle(() => screen.queryByRole("region", { name: "Conversa do card" }) !== null);
    const after = details() ?? null;
    const log = screen.queryByRole("region", { name: "Conversa do card" });
    expect({
      splitBefore,
      same: before !== null && before === after,
      splitAfter: after?.getAttribute("data-split") ?? null,
      apart: log !== null && log.closest("[data-slot='card-info']") === null,
      reachable: after?.getAttribute("tabindex") ?? null,
    }).toEqual({
      splitBefore: "false",
      same: true,
      splitAfter: "true",
      apart: true,
      reachable: "0",
    });
  });

  // #641: the board's columns scrolled sideways inside the page's own scroller, and their
  // scrollbar sat under the tallest column, below the window. The board fills the page now: the
  // columns row sits outside the page's scroll area. How it scrolls and snaps is CSS, which this
  // DOM cannot check; the test keeps the structure: the row outside the scroller, a list per column.
  test("the board fills its page outside the page's scroll area, with one list per column", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Coluna", "faça");
    const row = document.querySelector("[data-slot='board-columns']");
    const body = row?.closest("[data-slot='page-body']");
    const lists = [
      ...document.querySelectorAll("[data-slot='board-columns'] section[data-column] > ul"),
    ];
    expect({
      fill:
        body !== null && body !== undefined && body.closest("[data-slot='scroll-area']") === null,
      lists: lists.length,
    }).toEqual({ fill: true, lists: 5 });
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
    const chat = screen.queryByRole("region", { name: "Conversa do card" }) as HTMLElement;
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

    // No PR provider (#1543): there is no Open PR to press, and the panel says why, in the app's language.
    expect(screen.queryByRole("button", { name: "Abrir PR" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(document.body.textContent ?? "").toContain("este projeto está sem provedor de PR");
    await click("Conversa");
    expect(screen.queryByRole("log")).not.toBeNull();
  });

  test("remover o host tira os cards dele do app", async () => {
    const { repo, store } = await setup();
    await openBoard(repo);
    await createCard("Some junto", "faça");
    expect(Object.keys(store.getState().cards)).toHaveLength(1);
    await act(async () => {
      await store.roster.remove(store.getState().hosts[0]?.id ?? "");
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
