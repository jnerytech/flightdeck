import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { cardWhen, newBoard } from "../support/board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A board with a project and the cards A, B and C in its Backlog. */
async function setup() {
  const ctx = newBoard();
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const ids = ["A", "B", "C"].map(
    (title) => ctx.board.createCard(project.id, { title, description: "" }).id,
  ) as [string, string, string];
  // A started card goes on preparing its worktree (a git run) after `startCard` returns: the test
  // waits for every run to have its session or to have ended, so no git is left running into the
  // next test file (issue #747).
  cleanups.push(async () => {
    const prepared = await Promise.all(
      ids.map((id) =>
        cardWhen(ctx.board, id, (card) =>
          card.runs.every((run) => run.sessionId !== null || run.endedAt !== null),
        ),
      ),
    );
    ctx.board.stop();
    expect(prepared.every((card) => card !== null)).toBe(true);
  });
  return { ...ctx, project, ids };
}

async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof FlightdeckError) {
      return { code: error.code, reason: error.reason, params: error.params };
    }
    throw error;
  }
  return null;
}

describe("deps-gate: a blocked card does not start", () => {
  test("it is refused with the blockers' titles, and no run is made", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.updateCard(c, { blockedBy: [a, b] });
    const out = await refusal(() => board.startCard(c));
    expect(out).toEqual({
      code: "invalid_state",
      reason: "card_blocked",
      params: { blockers: "A, B" },
    });
    expect(board.getCard(c).runs).toEqual([]);
    expect(board.getCard(c).queued).toBe(false);
  });

  test("it starts once its blockers are satisfied, and a card with none is untouched", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.updateCard(b, { blockedBy: [a] });
    board.moveCard(a, "done");
    await board.startCard(b);
    expect(board.getCard(b).runs).toHaveLength(1);
    await board.startCard(c);
    expect(board.getCard(c).runs).toHaveLength(1);
  });

  test("moving it by hand is not gated: it moves a pin and starts nothing", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    board.moveCard(b, "in_progress");
    expect(board.getCard(b).column).toBe("in_progress");
    expect(board.getCard(b).runs).toEqual([]);
  });

  test("a fix run is never gated: the PR is already there", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    await board.startCard(b, { fix: { prompt: "conserte" } });
    expect(board.getCard(b).runs).toHaveLength(1);
  });

  test("an arena of a blocked card is refused, and no variant is made", async () => {
    const { board, project, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    const out = await refusal(() => board.startArena(b, { variants: [{}, {}] }));
    expect(out?.reason).toBe("card_blocked");
    expect(board.getBoard(project.id).columns.flatMap((column) => column.cards)).toHaveLength(3);
  });
});
