import { afterEach, describe, expect, test } from "bun:test";
import { newBoard } from "./board-helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

/** A project whose base branch an older daemon stored without checking it. */
async function withStoredBase(base: string) {
  const ctx = newBoard();
  boards.push(ctx.board);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  ctx.store.db.query("UPDATE projects SET base_branch = ? WHERE id = ?").run(base, project.id);
  return { ctx, id: project.id };
}

describe("rev-stored: a base branch stored before it was checked is marked, so the person fixes it (issue #369)", () => {
  test("a base that is an option, a refspec or not a branch name is marked on the wire", async () => {
    for (const base of ["--output=/tmp/x", "-x", "+x:refs/heads/y", "a:b", "a..b", "x.lock", ""]) {
      const { ctx, id } = await withStoredBase(base);
      const sent = await ctx.board.forWire(ctx.board.getProject(id));
      expect(sent.baseBranchInvalid, base).toBe(true);
    }
  });

  test("a real base, and the HEAD of a detached checkout, are not marked", async () => {
    for (const base of ["main", "release/1.2", "feature/ü-é", "HEAD"]) {
      const { ctx, id } = await withStoredBase(base);
      const sent = await ctx.board.forWire(ctx.board.getProject(id));
      expect(sent.baseBranchInvalid, base).toBeUndefined();
    }
  });

  test("updating the base to a real branch clears the mark", async () => {
    const { ctx, id } = await withStoredBase("--exec=x");
    expect((await ctx.board.forWire(ctx.board.getProject(id))).baseBranchInvalid).toBe(true);
    ctx.board.updateProject(id, { baseBranch: "main" });
    expect((await ctx.board.forWire(ctx.board.getProject(id))).baseBranchInvalid).toBeUndefined();
  });
});
