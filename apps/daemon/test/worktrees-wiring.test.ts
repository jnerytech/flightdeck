import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorktrees } from "../src/worktrees/wiring.ts";
import { git, newBoard } from "./board-helpers.ts";

/** A board with one project, a worktree of fd/one and a card (and a variant card) pointing at it. */
async function setup() {
  const ctx = newBoard();
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const path = join(ctx.repo, ".flightdeck", "worktrees", "one");
  git(ctx.repo, "worktree", "add", "-q", "-b", "fd/one", path, "main");
  const card = ctx.board.createCard(project.id, { title: "One", description: "" });
  const variant = ctx.board.createCard(project.id, { title: "Variant", description: "" });
  const other = join(ctx.repo, ".flightdeck", "worktrees", "two");
  git(ctx.repo, "worktree", "add", "-q", "-b", "fd/two", other, "main");
  ctx.store.db.query("UPDATE cards SET worktree_path = ? WHERE id = ?").run(path, card.id);
  ctx.store.db
    .query("UPDATE cards SET worktree_path = ?, arena_of = ? WHERE id = ?")
    .run(other, card.id, variant.id);
  return { ...ctx, project, card, variant, path, other };
}

describe("worktrees-wiring: the board's cards behind the panel (issue #152)", () => {
  test("worktreeCards lists the cards with a worktree, arena variants included", async () => {
    const s = await setup();
    const none = s.board.createCard(s.project.id, { title: "No tree", description: "" });
    const ids = s.board.worktreeCards(s.project.id).map((c) => c.id);
    expect(ids.sort()).toEqual([s.card.id, s.variant.id].sort());
    expect(ids).not.toContain(none.id);
  });

  test("releaseWorktree clears the card's worktree and tells the watchers", async () => {
    const s = await setup();
    const seen: Array<string | null> = [];
    s.board.watch((card) => void seen.push(card.worktreePath));
    s.board.releaseWorktree(s.card.id);
    expect(s.board.getCard(s.card.id).worktreePath).toBeNull();
    expect(seen).toContain(null);
  });

  test("the panel sees the projects, the cards, live sessions and runs, and frees the card on removal", async () => {
    const s = await setup();
    let live = false;
    let running = false;
    const w = createWorktrees({
      board: s.board,
      sessions: { list: () => (live ? [{ cwd: join(s.path, "src"), status: "running" }] : []) },
      runs: { state: (id) => ({ status: running && id === s.card.id ? "running" : "idle" }) },
    });
    const first = (await w.list()).worktrees;
    expect(first.map((i) => i.cardId).sort()).toEqual([s.card.id, s.variant.id].sort());
    expect(first.find((i) => i.path === s.path)?.blockers).toEqual([]);
    live = true;
    expect((await w.list()).worktrees.find((i) => i.path === s.path)?.blockers).toEqual([
      "live_session",
    ]);
    live = false;
    running = true;
    expect((await w.list()).worktrees.find((i) => i.path === s.path)?.blockers).toEqual([
      "running",
    ]);
    running = false;
    // An ended session does not hold the folder.
    const ended = createWorktrees({
      board: s.board,
      sessions: { list: () => [{ cwd: s.path, status: "ended" }] },
      runs: { state: () => ({ status: "idle" }) },
    });
    expect((await ended.list()).worktrees.find((i) => i.path === s.path)?.blockers).toEqual([]);
    const result = await w.remove([{ projectId: s.project.id, path: s.path }]);
    expect(result.removed.map((r) => r.path)).toEqual([s.path]);
    expect(s.board.getCard(s.card.id).worktreePath).toBeNull();
  });

  test("the size comes from du, with a deadline, and the disk from statfs", async () => {
    const s = await setup();
    mkdirSync(join(s.path, "big"));
    writeFileSync(join(s.path, "big", "file.bin"), Buffer.alloc(300 * 1024));
    const w = createWorktrees({
      board: s.board,
      sessions: { list: () => [] },
      runs: { state: () => ({ status: "idle" }) },
    });
    const { worktrees, disks } = await w.list();
    expect(worktrees.find((i) => i.path === s.path)?.sizeBytes).toBeGreaterThan(300 * 1024);
    expect(disks[0]?.totalBytes).toBeGreaterThan(0);
  });
});
