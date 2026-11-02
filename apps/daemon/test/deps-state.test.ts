import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** A board with a project and the cards A, B and C in its Backlog. */
async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const ids = ["A", "B", "C"].map(
    (title) => ctx.board.createCard(project.id, { title, description: "" }).id,
  ) as [string, string, string];
  return { ...ctx, project, ids };
}

describe("deps-state: what a card still waits for", () => {
  test("a blocker satisfies when its card is in Done, and stops when it leaves", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    expect(board.getCard(b).waitingOn).toEqual([a]);
    board.moveCard(a, "done");
    expect(board.getCard(b).waitingOn).toEqual([]);
    expect(board.getCard(b).blockedBy).toEqual([a]);
    board.moveCard(a, "review");
    expect(board.getCard(b).waitingOn).toEqual([a]);
  });

  test("only the blockers that are not satisfied are waited on, in the order they were set", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.updateCard(c, { blockedBy: [b, a] });
    board.moveCard(b, "done");
    expect(board.getCard(c).waitingOn).toEqual([a]);
  });

  test("with merged, Done is not enough: the blocker's PR must be merged", async () => {
    const { board, store, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a], unblockWhen: "merged" });
    board.moveCard(a, "done");
    expect(board.getCard(b).waitingOn).toEqual([a]);
    store.db.query("UPDATE cards SET pr_state = 'merged' WHERE id = ?").run(a);
    expect(board.getCard(b).waitingOn).toEqual([]);
  });

  test("a card that has a run is not waiting any more, and stays so when a blocker reopens", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    await board.startCard(b);
    board.updateCard(b, { blockedBy: [a] });
    expect(board.getCard(b).blockedBy).toEqual([a]);
    expect(board.getCard(b).waitingOn).toEqual([]);
    board.moveCard(a, "done");
    board.moveCard(a, "waiting");
    expect(board.getCard(b).waitingOn).toEqual([]);
  });

  test("the watchers hear about the dependent when its blocker changes column", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    const heard: string[][] = [];
    board.watch((card) => {
      if (card.id === b) heard.push(card.waitingOn);
    });
    board.moveCard(a, "done");
    expect(heard.at(-1)).toEqual([]);
  });
});
