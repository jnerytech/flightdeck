import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { must } from "./helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** Two cards of one project, both started and waiting in review, each in its own worktree. */
async function twoCards() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const ids: string[] = [];
  for (const title of ["First", "Second"]) {
    const card = ctx.board.createCard(project.id, { title, description: "go" });
    await ctx.board.startCard(card.id);
    ids.push(card.id);
  }
  const trees: string[] = [];
  for (const id of ids) {
    const started = await cardWhen(ctx.board, id, (c) => c.column === "review");
    trees.push(must(started?.worktreePath, "the started card's worktree"));
  }
  return { ...ctx, ids: ids as [string, string], trees: trees as [string, string] };
}

describe("board: the conflict radar (#1405)", () => {
  test("two cards editing the same file are both flagged; one that edits another file is not", async () => {
    const { board, ids, trees } = await twoCards();
    writeFileSync(join(trees[0], "README.md"), "# first\n");
    writeFileSync(join(trees[1], "README.md"), "# second\n");
    await board.refreshConflicts(ids[0]);
    expect(board.getCard(ids[0]).mayConflict).toBeUndefined();
    await board.refreshConflicts(ids[1]);
    expect(board.getCard(ids[0]).mayConflict).toEqual([
      { cardId: ids[1], title: "Second", files: ["README.md"] },
    ]);
    expect(board.getCard(ids[1]).mayConflict).toEqual([
      { cardId: ids[0], title: "First", files: ["README.md"] },
    ]);
    writeFileSync(join(trees[1], "README.md"), "");
    writeFileSync(join(trees[1], "other.txt"), "x\n");
    await board.refreshConflicts(ids[1]);
    expect([board.getCard(ids[0]).mayConflict, board.getCard(ids[1]).mayConflict]).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("a card that is discarded takes its flag off the other", async () => {
    const { board, ids, trees } = await twoCards();
    for (const tree of trees) writeFileSync(join(tree, "README.md"), `# ${tree}\n`);
    await board.refreshConflicts(ids[0]);
    await board.refreshConflicts(ids[1]);
    expect(board.getCard(ids[0]).mayConflict?.length).toBe(1);
    await board.discardCard(ids[1], true);
    expect(board.getCard(ids[0]).mayConflict).toBeUndefined();
  });

  test("the watchers hear of the other card when its flag appears", async () => {
    const { board, ids, trees } = await twoCards();
    for (const tree of trees) writeFileSync(join(tree, "README.md"), `# ${tree}\n`);
    await board.refreshConflicts(ids[0]);
    const heard: string[] = [];
    const off = board.watch((card) => {
      if (card.mayConflict) heard.push(card.id);
    });
    await board.refreshConflicts(ids[1]);
    off();
    expect(heard.sort()).toEqual([...ids].sort());
  });
});
