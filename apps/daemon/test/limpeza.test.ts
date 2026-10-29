import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import type { PrProviderKind } from "../src/board/types.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

async function reviewedCard(prProvider: PrProviderKind = "none") {
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
    worktree: reviewed?.worktreePath ?? "",
    branch: reviewed?.branch ?? "",
    sessionId: reviewed?.sessionId ?? "",
  };
}

const worktrees = (repo: string) => git(repo, "worktree", "list", "--porcelain");

describe("limpeza", () => {
  test("concluir à mão remove a worktree limpa, fecha a sessão e mantém a branch", async () => {
    const { board, card, repo, worktree, branch, sessionId, manager } = await reviewedCard();
    const done = await board.completeCard(card.id, true);
    expect(done).toMatchObject({ column: "done", columnLocked: true, worktreePath: null });
    expect(done.notice).toBeNull();
    expect(existsSync(worktree)).toBe(false);
    expect(worktrees(repo)).not.toContain("worktrees");
    expect(git(repo, "branch", "--list", branch)).toContain(branch);
    expect(manager.get(sessionId).status).toBe("ended");
    expect(done.runs.every((run) => run.endedAt !== null)).toBe(true);
  });

  test("com alteração pendente não remove e avisa; limpa, a próxima conclusão remove", async () => {
    const { board, card, worktree, repo } = await reviewedCard();
    writeFileSync(join(worktree, "README.md"), "mudado e não commitado\n");
    const kept = await board.completeCard(card.id, true);
    expect(kept.column).toBe("done");
    expect(kept.worktreePath).toBe(worktree);
    expect(kept.notice ?? "").toContain("alterações pendentes");
    expect(existsSync(join(worktree, "README.md"))).toBe(true);
    git(worktree, "commit", "-q", "-am", "salvo");
    const removed = await board.completeCard(card.id, true);
    expect(removed).toMatchObject({ worktreePath: null, notice: null });
    expect(worktrees(repo)).not.toContain("worktrees");
  });

  test("arquivo novo não rastreado também conta como pendente", async () => {
    const { board, card, worktree } = await reviewedCard();
    writeFileSync(join(worktree, "solto.txt"), "não rastreado\n");
    const kept = await board.completeCard(card.id, true);
    expect(kept.worktreePath).toBe(worktree);
    expect(existsSync(join(worktree, "solto.txt"))).toBe(true);
  });

  test("concluir sem confirm é recusado e nada muda", async () => {
    const { board, card, worktree } = await reviewedCard();
    const result = await board.completeCard(card.id, false).then(
      () => "concluiu",
      (error: { code?: string }) => error.code,
    );
    expect(result).toBe("invalid_state");
    expect(board.getCard(card.id)).toMatchObject({ column: "review", worktreePath: worktree });
  });

  test("PR mesclado conclui o card e remove a worktree limpa", async () => {
    const gh = installFakeCli("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: "https://github.com/acme/repo/pull/9\n" },
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
    ]);
    cleanups.push(gh.restore);
    const { board, card, root, repo, worktree, sessionId, manager } = await reviewedCard("github");
    git(root, "init", "-q", "--bare", "remote.git");
    git(repo, "remote", "add", "origin", join(root, "remote.git"));
    expect(git(repo, "remote", "get-url", "origin")).toBe(join(root, "remote.git"));
    await board.createPr(card.id);
    gh.respond([
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "MERGED" }) },
    ]);
    const done = await cardWhen(board, card.id, (c) => c.worktreePath === null);
    expect(done ?? {}).toMatchObject({ column: "done", prState: "merged" });
    expect(existsSync(worktree)).toBe(false);
    expect(manager.get(sessionId).status).toBe("ended");
  });
});
