import { afterEach, describe, expect, test } from "bun:test";
import { Board } from "../src/board/board.ts";
import { type BoardEvent, nextColumn } from "../src/board/columns.ts";
import type { BoardColumn } from "../src/board/types.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

const free = (column: BoardColumn) => ({ column, locked: false });

describe("colunas: tabela de colunas automáticas", () => {
  const rows: Array<[string, BoardEvent, BoardColumn]> = [
    ["iniciado (fila ou preparo)", { type: "started" }, "in_progress"],
    ["sessão starting", { type: "session", status: "starting" }, "in_progress"],
    ["sessão running", { type: "session", status: "running" }, "in_progress"],
    ["sessão awaiting_permission", { type: "session", status: "awaiting_permission" }, "waiting"],
    ["sessão error", { type: "session", status: "error" }, "waiting"],
    ["turno concluído (idle após um turno)", { type: "turn", isError: false }, "review"],
    ["turno com erro ou interrompido", { type: "turn", isError: true }, "waiting"],
    ["PR aberto", { type: "pr", state: "open" }, "review"],
    ["PR mesclado", { type: "pr", state: "merged" }, "done"],
    ["PR fechado sem merge", { type: "pr", state: "closed" }, "waiting"],
    ["preparação falhou", { type: "failed" }, "waiting"],
  ];
  for (const [name, event, column] of rows) {
    test(`${name} → ${column}`, () => {
      expect(nextColumn(free("backlog"), event)).toEqual({ column, locked: false });
    });
  }

  test("status idle e ended sozinhos não mexem no card (retomadas vão a idle sem turno)", () => {
    expect(nextColumn(free("in_progress"), { type: "session", status: "idle" })).toEqual(
      free("in_progress"),
    );
    expect(nextColumn(free("review"), { type: "session", status: "ended" })).toEqual(
      free("review"),
    );
  });

  test("mover à mão para Backlog ou Concluído trava; para as outras, não", () => {
    expect(nextColumn(free("review"), { type: "moved", column: "backlog" })).toEqual({
      column: "backlog",
      locked: true,
    });
    expect(nextColumn(free("review"), { type: "moved", column: "done" })).toEqual({
      column: "done",
      locked: true,
    });
    expect(nextColumn(free("backlog"), { type: "moved", column: "review" })).toEqual(
      free("review"),
    );
  });

  test("travado, só o próximo início ou outro movimento manual mudam a coluna", () => {
    const locked = { column: "done" as const, locked: true };
    for (const event of [
      { type: "session", status: "running" },
      { type: "turn", isError: false },
      { type: "pr", state: "closed" },
      { type: "failed" },
    ] as BoardEvent[]) {
      expect(nextColumn(locked, event)).toEqual(locked);
    }
    expect(nextColumn(locked, { type: "started" })).toEqual(free("in_progress"));
    expect(nextColumn(locked, { type: "moved", column: "waiting" })).toEqual(free("waiting"));
  });
});

async function setup(delayMs?: number) {
  const ctx = newBoard({}, delayMs);
  boards.push(ctx.board);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  return { ...ctx, project };
}

describe("colunas: no board", () => {
  test("card criado → Backlog; iniciado → Em andamento; turno concluído → Em revisão", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Fluxo", description: "faça" });
    expect(card.column).toBe("backlog");
    const started = await board.startCard(card.id);
    expect(started.column).toBe("in_progress");
    const reviewed = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(reviewed).not.toBeNull();
    expect(reviewed?.sessionStatus).toBe("idle");
  });

  test("pedido de permissão → Esperando você; respondido → Em andamento e depois Em revisão", async () => {
    const { board, project, manager, store } = await setup();
    const card = board.createCard(project.id, { title: "Permissão", description: "[tool]" });
    await board.startCard(card.id);
    const waiting = await cardWhen(board, card.id, (c) => c.column === "waiting");
    expect(waiting?.sessionStatus).toBe("awaiting_permission");
    const request = store.pendingPermissions(waiting?.sessionId ?? "")[0];
    expect(request).toBeDefined();
    manager.respondPermission({ requestId: request?.id ?? "", decision: "allow" });
    expect(await cardWhen(board, card.id, (c) => c.column === "review")).not.toBeNull();
  });

  test("sessão em erro → Esperando você", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Quebra", description: "[fail]" });
    await board.startCard(card.id);
    const failed = await cardWhen(board, card.id, (c) => c.sessionStatus === "error");
    expect(failed?.column).toBe("waiting");
  });

  test("Parar interrompe o turno: o card vai para Esperando você", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Parar", description: "[tool]" });
    await board.startCard(card.id);
    expect(
      await cardWhen(board, card.id, (c) => c.sessionStatus === "awaiting_permission"),
    ).not.toBeNull();
    await board.stopCard(card.id);
    const stopped = await cardWhen(board, card.id, (c) => c.sessionStatus === "idle");
    expect(stopped?.column).toBe("waiting");
  });

  test("trava manual: em Backlog o turno não move o card; o próximo início destrava", async () => {
    const { board, project, manager } = await setup(30);
    const card = board.createCard(project.id, { title: "Travado", description: "devagar" });
    await board.startCard(card.id);
    const running = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(running).not.toBeNull();
    const moved = board.moveCard(card.id, "backlog");
    expect(moved).toMatchObject({ column: "backlog", columnLocked: true });
    expect(await cardWhen(board, card.id, (c) => c.sessionStatus === "idle")).not.toBeNull();
    expect(board.getCard(card.id).column).toBe("backlog");
    manager.send(running?.sessionId ?? "", "mais uma");
    await poll(() => manager.get(running?.sessionId ?? "").status === "running", 1000);
    expect(await cardWhen(board, card.id, (c) => c.sessionStatus === "idle")).not.toBeNull();
    expect(board.getCard(card.id).column).toBe("backlog");
    const restarted = await board.startCard(card.id);
    expect(restarted).toMatchObject({ column: "in_progress", columnLocked: false });
    expect(await cardWhen(board, card.id, (c) => c.column === "review")).not.toBeNull();
  });

  test("movido à mão para outra coluna, o próximo evento volta a mandar", async () => {
    const { board, project, manager } = await setup();
    const card = board.createCard(project.id, { title: "Solto", description: "faça" });
    await board.startCard(card.id);
    const reviewed = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(reviewed).not.toBeNull();
    const moved = board.moveCard(card.id, "waiting", 7.5);
    expect(moved).toMatchObject({ column: "waiting", columnLocked: false, position: 7.5 });
    manager.send(reviewed?.sessionId ?? "", "de novo");
    expect(
      await cardWhen(board, card.id, (c) => c.column === "review" && c.runs.length === 1),
    ).not.toBeNull();
  });

  test("um board novo sobre o mesmo banco continua acompanhando as sessões dos cards", async () => {
    const { board, project, manager, store } = await setup();
    const card = board.createCard(project.id, { title: "Reinício", description: "faça" });
    await board.startCard(card.id);
    const reviewed = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(reviewed).not.toBeNull();
    board.stop();
    const again = new Board({ db: store.db, manager, allowedRoots: [] });
    boards.push(again);
    again.moveCard(card.id, "in_progress");
    manager.send(reviewed?.sessionId ?? "", "depois do reinício");
    expect(
      await cardWhen(again, card.id, (c) => c.column === "review" && c.sessionStatus === "idle"),
    ).not.toBeNull();
  });
});
