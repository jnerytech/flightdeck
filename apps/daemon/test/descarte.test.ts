import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup(maxParallelRuns?: number) {
  const ctx = newBoard(maxParallelRuns ? { maxParallelRuns } : {});
  boards.push(ctx.board);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  return { ...ctx, project };
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code: string }).code;
  }
};

describe("descarte", () => {
  test("sem confirm: true é recusado e nada é apagado", async () => {
    const { board, project, repo } = await setup();
    const card = board.createCard(project.id, { title: "Talvez", description: "faça" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(started).not.toBeNull();
    const result = await board.discardCard(card.id, false).then(
      () => "descartou",
      (error: { code?: string }) => error.code,
    );
    expect(result).toBe("invalid_state");
    expect(existsSync(started?.worktreePath ?? "")).toBe(true);
    expect(git(repo, "branch", "--list", "fd/*")).toContain("fd/talvez");
    expect(board.getCard(card.id).id).toBe(card.id);
  });

  test("com confirm remove a worktree (mesmo com alterações) e a branch local, e o card sai do board", async () => {
    const { board, project, repo, manager } = await setup();
    const card = board.createCard(project.id, { title: "Jogar fora", description: "faça" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(started).not.toBeNull();
    const worktree = started?.worktreePath ?? "";
    writeFileSync(join(worktree, "README.md"), "alterado\n");
    writeFileSync(join(worktree, "novo.txt"), "não rastreado\n");
    const last = await board.discardCard(card.id, true);
    expect(last).toMatchObject({ id: card.id, discarded: true, worktreePath: null, branch: null });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, "branch", "--list", "fd/*")).toBe("");
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain("worktrees");
    expect(manager.get(started?.sessionId ?? "").status).toBe("ended");
    expect(codeOf(() => board.getCard(card.id))).toBe("not_found");
  });

  test("card nunca iniciado é só apagado", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Ideia", description: "d" });
    const last = await board.discardCard(card.id, true);
    expect(last.discarded).toBe(true);
    expect(codeOf(() => board.getCard(card.id))).toBe("not_found");
  });

  test("descartar um card na fila tira ele da fila", async () => {
    const { board, project, manager } = await setup(1);
    const a = board.createCard(project.id, { title: "Rodando", description: "[tool]" });
    const b = board.createCard(project.id, { title: "Na fila", description: "faça" });
    const c = board.createCard(project.id, { title: "Depois", description: "faça" });
    await board.startCard(a.id);
    expect(
      await cardWhen(board, a.id, (x) => x.sessionStatus === "awaiting_permission"),
    ).not.toBeNull();
    await board.startCard(b.id);
    await board.startCard(c.id);
    await board.discardCard(b.id, true);
    await board.stopCard(a.id);
    expect(await cardWhen(board, c.id, (x) => x.sessionId !== null)).not.toBeNull();
    // The discarded card never got a session: the slot went straight to the next one.
    expect(
      manager
        .list()
        .map((session) => session.name)
        .sort(),
    ).toEqual(["Depois", "Rodando"]);
  });
});
