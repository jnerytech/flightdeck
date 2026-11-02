import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Board, type BoardOptions } from "../src/board/board.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** A board with a project and the cards A, B and C in its Backlog. */
async function setup(overrides: Partial<BoardOptions> = {}) {
  const ctx = newBoard(overrides);
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const ids = ["A", "B", "C"].map(
    (title) => ctx.board.createCard(project.id, { title, description: "" }).id,
  ) as [string, string, string];
  return { ...ctx, project, ids };
}

describe("deps-autostart: the card is told when its blockers are done", () => {
  test("with auto-start off, the card gets the unblocked mark, and starting it clears the mark", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    expect(board.getCard(b).unblockedAt).toBeNull();
    board.moveCard(a, "done");
    expect(board.getCard(b).unblockedAt).not.toBeNull();
    expect(board.getCard(b).runs).toEqual([]);
    await board.startCard(b);
    expect(board.getCard(b).unblockedAt).toBeNull();
  });

  test("dismissing the mark clears it", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    board.moveCard(a, "done");
    board.dismissUnblocked(b);
    expect(board.getCard(b).unblockedAt).toBeNull();
  });

  test("only the last blocker to be satisfied unblocks the card", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.updateCard(c, { blockedBy: [a, b] });
    board.moveCard(a, "done");
    expect(board.getCard(c).unblockedAt).toBeNull();
    board.moveCard(b, "done");
    expect(board.getCard(c).unblockedAt).not.toBeNull();
  });

  test("a card linked to blockers that are already done is not marked: it was never blocked", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.moveCard(a, "done");
    board.updateCard(b, { blockedBy: [a] });
    board.updateCard(c, { blockedBy: [b] });
    board.moveCard(a, "review");
    board.moveCard(a, "done");
    expect(board.getCard(b).unblockedAt).not.toBeNull();
    expect(board.getCard(c).unblockedAt).toBeNull();
  });

  test("taking the last blocker away by hand does not mark or start the card", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a], autoStart: { workflow: null } });
    board.updateCard(b, { blockedBy: [] });
    expect(board.getCard(b).unblockedAt).toBeNull();
    expect(board.getCard(b).runs).toEqual([]);
  });

  test("a discarded last blocker unblocks the card like a finished one", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    await board.discardCard(a, true);
    expect(board.getCard(b).unblockedAt).not.toBeNull();
  });
});

describe("deps-autostart: the card starts by itself", () => {
  test("it starts once its last blocker is done, without the mark", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a], autoStart: { workflow: null } });
    board.moveCard(a, "done");
    const started = await cardWhen(board, b, (card) => card.runs.length === 1);
    expect(started).not.toBeNull();
    expect(board.getCard(b).unblockedAt).toBeNull();
  });

  test("it starts only once, however many times its blocker reopens and finishes", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a], autoStart: { workflow: null } });
    board.moveCard(a, "done");
    await cardWhen(board, b, (card) => card.runs.length === 1);
    board.moveCard(a, "review");
    board.moveCard(a, "done");
    await Bun.sleep(100);
    expect(board.getCard(b).runs).toHaveLength(1);
  });

  test("it waits in the queue like any start: a full host keeps it queued", async () => {
    const { board, project, ids } = await setup({ maxParallelRuns: 1 });
    const [a, b] = ids;
    const busy = board.createCard(project.id, { title: "busy", description: "" });
    await board.startCard(busy.id);
    board.updateCard(b, { blockedBy: [a], autoStart: { workflow: null } });
    board.moveCard(a, "done");
    const queued = await cardWhen(board, b, (card) => card.queued);
    expect(queued?.queueReason).toBe("slot");
  });

  test("a start that fails leaves the mark and says why", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a], autoStart: { workflow: "does-not-exist" } });
    board.moveCard(a, "done");
    const failed = await cardWhen(board, b, (card) => card.notice !== null);
    expect(failed?.notice).toStartWith("Auto-start failed: ");
    expect(failed?.unblockedAt).not.toBeNull();
    expect(failed?.runs).toEqual([]);
  });

  test("after a restart, a card whose blocker finished while the daemon was down starts, once", async () => {
    const { board, manager, store, ids, root } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a], autoStart: { workflow: null } });
    board.stop();
    store.db.query("UPDATE cards SET board_column = 'done' WHERE id = ?").run(a);
    const again = new Board({ db: store.db, manager, allowedRoots: [root] });
    cleanups.push(() => again.stop());
    expect(await cardWhen(again, b, (card) => card.runs.length === 1)).not.toBeNull();
    const third = new Board({ db: store.db, manager, allowedRoots: [root] });
    cleanups.push(() => third.stop());
    await Bun.sleep(100);
    expect(third.getCard(b).runs).toHaveLength(1);
  });
});
