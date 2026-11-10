import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Board } from "../src/board/board.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
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

/** A new board over the store of one that stopped, as the daemon builds it when it starts again. */
function reopen({
  store,
  manager,
  root,
}: Pick<ReturnType<typeof newBoard>, "store" | "manager" | "root">) {
  const board = new Board({ db: store.db, manager, allowedRoots: [root] });
  cleanups.push(() => board.stop());
  return board;
}

describe("board: the conflict radar (#1405)", () => {
  test("two cards editing the same file are both flagged; one that edits another file is not", async () => {
    const { board, ids, trees } = await twoCards();
    // One card edits it first: nothing to flag yet. The turn that ended also refreshes by itself.
    writeFileSync(join(trees[0], "README.md"), "# first\n");
    await board.refreshConflicts(ids[0]);
    expect(board.getCard(ids[0]).mayConflict).toBeUndefined();
    writeFileSync(join(trees[1], "README.md"), "# second\n");
    await board.refreshConflicts(ids[1]);
    expect(board.getCard(ids[0]).mayConflict).toEqual([
      { cardId: ids[1], title: "Second", files: ["README.md"] },
    ]);
    expect(board.getCard(ids[1]).mayConflict).toEqual([
      { cardId: ids[0], title: "First", files: ["README.md"] },
    ]);
    git(trees[1], "checkout", "--", "README.md");
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

  test("a board that starts again reads the cards that already have a worktree", async () => {
    const { board, store, manager, root, ids, trees } = await twoCards();
    for (const tree of trees) writeFileSync(join(tree, "README.md"), `# ${tree}\n`);
    board.stop();
    // The daemon starts again over the same database: nothing has refreshed the radar yet.
    const again = reopen({ store, manager, root });
    const flagged = await cardWhen(again, ids[0], (c) => c.mayConflict !== undefined);
    expect(flagged?.mayConflict).toEqual([
      { cardId: ids[1], title: "Second", files: ["README.md"] },
    ]);
    expect(again.getCard(ids[1]).mayConflict).toEqual([
      { cardId: ids[0], title: "First", files: ["README.md"] },
    ]);
  });

  test("the watchers hear of the other card when its flag appears", async () => {
    const { board, ids, trees } = await twoCards();
    const heard = new Set<string>();
    const off = board.watch((card) => {
      if (card.mayConflict) heard.add(card.id);
    });
    for (const tree of trees) writeFileSync(join(tree, "README.md"), `# ${tree}\n`);
    await board.refreshConflicts(ids[0]);
    await board.refreshConflicts(ids[1]);
    off();
    expect([...heard].sort()).toEqual([...ids].sort());
  });
});
