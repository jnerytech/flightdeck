import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { must } from "./helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** Writes and commits a file in `cwd`. */
export function commit(cwd: string, file: string, text: string, message = `muda ${file}`) {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
}

/** A board, its project and a card started and idle, with the card's worktree. */
export async function ready(title = "Integrar", description = "oi", base?: string) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  if (base) git(ctx.repo, "branch", base);
  const project = await ctx.board.addProject({
    path: ctx.repo,
    promptTemplate: "",
    ...(base ? { baseBranch: base } : {}),
  });
  const card = ctx.board.createCard(project.id, { title, description });
  await ctx.board.startCard(card.id);
  const started = await cardWhen(
    ctx.board,
    card.id,
    // The first turn over: idle, or holding an approval (the busy card).
    (c) =>
      c.worktreePath !== null &&
      (c.sessionStatus === "idle" || c.sessionStatus === "awaiting_permission"),
  );
  return {
    ...ctx,
    project,
    cardId: card.id,
    worktree: must(started?.worktreePath, "worktreePath"),
    branch: started?.branch ?? "",
  };
}
