import { expect } from "bun:test";
import type { PrProviderKind } from "../../src/board/types.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { must } from "./helpers.ts";

/** A card started and moved to review on a real repo: the starting point of every cleanup test. */
export async function reviewedCard(
  cleanups: Array<() => void>,
  prProvider: PrProviderKind = "none",
) {
  const ctx = newBoard({ prPollIntervalMs: 30 });
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, prProvider, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Limpar", description: "faça" });
  await ctx.board.startCard(card.id);
  const reviewed = await cardWhen(ctx.board, card.id, (c) => c.column === "review");
  expect(reviewed).not.toBeNull();
  return {
    ...ctx,
    card,
    worktree: must(reviewed?.worktreePath, "worktreePath"),
    branch: reviewed?.branch ?? "",
    sessionId: reviewed?.sessionId ?? "",
  };
}
