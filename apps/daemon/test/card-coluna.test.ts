import { afterEach, describe, expect, test } from "bun:test";
import { newBoard } from "./board-helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup() {
  const ctx = newBoard({});
  boards.push(ctx.board);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  return { ...ctx, project };
}

describe("card-coluna: a card can be born in a column", () => {
  test("without a column it lands in the Backlog, as always", async () => {
    const { board, project } = await setup();
    expect(board.createCard(project.id, { title: "A", description: "d" }).column).toBe("backlog");
  });

  test("with a column it is created there, at the end of it, in one step", async () => {
    const { board, project } = await setup();
    const first = board.createCard(project.id, { title: "A", description: "d", column: "review" });
    const second = board.createCard(project.id, { title: "B", description: "d", column: "review" });
    expect(first.column).toBe("review");
    expect(second.column).toBe("review");
    const review = board
      .getBoard(project.id)
      .columns.find((c) => c.column === "review")
      ?.cards.map((c) => c.title);
    expect(review).toEqual(["A", "B"]);
    expect(
      board
        .getBoard(project.id)
        .columns.find((c) => c.column === "backlog")
        ?.cards.map((c) => c.title),
    ).toEqual([]);
  });
});
