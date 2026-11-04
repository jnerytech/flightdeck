import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { cardWhen, newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

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

const refusal = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, reason } = error as { code: string; reason?: string };
    return { code, reason };
  }
};

describe("card-excluir", () => {
  test("without confirm the card stays", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Idea", description: "d" });
    expect(refusal(() => board.deleteCard(card.id, false))).toEqual({
      code: "invalid_state",
      reason: "delete_confirm",
    });
    expect(board.getCard(card.id).id).toBe(card.id);
  });

  test("a card that never started is deleted, and the watchers hear its last state as discarded", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Idea", description: "d" });
    const heard: Card[] = [];
    board.watch((c) => heard.push(c));
    const last = board.deleteCard(card.id, true);
    expect(last).toMatchObject({ id: card.id, discarded: true });
    expect(refusal(() => board.getCard(card.id))?.code).toBe("not_found");
    expect(heard.some((c) => c.id === card.id && c.discarded)).toBe(true);
  });

  test("a card that started is refused with its reason, and nothing is removed", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Started", description: "do it" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(started?.worktreePath).not.toBeNull();
    expect(refusal(() => board.deleteCard(card.id, true))).toEqual({
      code: "invalid_state",
      reason: "card_delete_started",
    });
    expect(board.getCard(card.id).worktreePath).toBe(started?.worktreePath ?? null);
  });

  test("the cards it held up are free of it and told why", async () => {
    const { board, project } = await setup();
    const blocker = board.createCard(project.id, { title: "A", description: "d" });
    const held = board.createCard(project.id, {
      title: "B",
      description: "d",
      blockedBy: [blocker.id],
    });
    expect(board.getCard(held.id).blockedBy).toEqual([blocker.id]);
    board.deleteCard(blocker.id, true);
    const after = board.getCard(held.id);
    expect(after.blockedBy).toEqual([]);
    expect(after.notice).toBe('Blocker "A" was deleted and no longer blocks this card.');
  });

  test("deleting a card that waits for others frees them of it", async () => {
    const { board, project } = await setup();
    const blocker = board.createCard(project.id, { title: "A", description: "d" });
    const held = board.createCard(project.id, {
      title: "B",
      description: "d",
      blockedBy: [blocker.id],
    });
    board.deleteCard(held.id, true);
    expect(board.getCard(blocker.id).blocking).toEqual([]);
  });
});
