import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** A project whose repository has a bare `origin`, with cards A (the blocker) and B (blocked, merged). */
async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const origin = join(ctx.root, "origin.git");
  git(ctx.root, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(ctx.repo, "remote", "add", "origin", origin);
  git(ctx.repo, "push", "-q", "origin", "main");
  git(ctx.repo, "fetch", "-q", "origin");
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const a = ctx.board.createCard(project.id, { title: "A", description: "" }).id;
  const b = ctx.board.createCard(project.id, {
    title: "B",
    description: "",
    blockedBy: [a],
    unblockWhen: "merged",
  }).id;
  /** The blocker's PR merged on the remote: a commit lands on origin's main, from another clone. */
  const mergeOnRemote = (file: string) => {
    const other = join(ctx.root, `clone-${file}`);
    git(ctx.root, "clone", "-q", origin, other);
    git(other, "config", "commit.gpgsign", "false");
    writeFileSync(join(other, file), "from the blocker\n");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", `blocker ${file}`);
    git(other, "push", "-q", "origin", "main");
  };
  const satisfy = () => {
    ctx.board.moveCard(a, "done");
    ctx.store.db.query("UPDATE cards SET pr_state = 'merged' WHERE id = ?").run(a);
  };
  return { ...ctx, project, a, b, origin, mergeOnRemote, satisfy };
}

const worktreeOf = async (board: Awaited<ReturnType<typeof setup>>["board"], id: string) => {
  const card = await cardWhen(board, id, (c) => c.worktreePath !== null);
  expect(card).not.toBeNull();
  return card?.worktreePath as string;
};

describe("deps-base: a card that waited starts from the base after its blockers merged", () => {
  test("a PR merged on the remote is in the new worktree, and the local base branch is not moved", async () => {
    const { board, repo, b, mergeOnRemote, satisfy } = await setup();
    const before = git(repo, "rev-parse", "main");
    mergeOnRemote("blocker.txt");
    satisfy();
    await board.startCard(b);
    const worktree = await worktreeOf(board, b);
    expect(existsSync(join(worktree, "blocker.txt"))).toBe(true);
    expect(git(repo, "rev-parse", "main")).toBe(before);
  });

  test("a local merge already moved the base: the worktree starts from it, and origin is not needed", async () => {
    const { board, repo, b, satisfy } = await setup();
    writeFileSync(join(repo, "local.txt"), "merged here\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-q", "-m", "local merge");
    satisfy();
    await board.startCard(b);
    expect(existsSync(join(await worktreeOf(board, b), "local.txt"))).toBe(true);
  });

  test("a base that diverged from origin keeps the local one", async () => {
    const { board, repo, b, mergeOnRemote, satisfy } = await setup();
    writeFileSync(join(repo, "local.txt"), "mine\n");
    git(repo, "add", "local.txt");
    git(repo, "commit", "-q", "-m", "local only");
    mergeOnRemote("remote.txt");
    satisfy();
    await board.startCard(b);
    const worktree = await worktreeOf(board, b);
    expect(existsSync(join(worktree, "local.txt"))).toBe(true);
    expect(existsSync(join(worktree, "remote.txt"))).toBe(false);
  });

  test("a fetch that fails is a notice on the card, and the run still starts", async () => {
    const { board, repo, root, b, satisfy } = await setup();
    git(repo, "remote", "set-url", "origin", join(root, "gone.git"));
    satisfy();
    await board.startCard(b);
    const card = await cardWhen(board, b, (c) => c.worktreePath !== null);
    expect(card?.notice).toStartWith("Could not refresh main from origin: ");
    expect(card?.runs).toHaveLength(1);
  });

  test("a repository with no origin starts from the local base, with no notice", async () => {
    const { board, repo, b, satisfy } = await setup();
    git(repo, "remote", "remove", "origin");
    satisfy();
    await board.startCard(b);
    const card = await cardWhen(board, b, (c) => c.worktreePath !== null);
    expect(card?.notice).toBeNull();
  });

  test("a card with no blockers does not fetch: a broken origin does not matter", async () => {
    const { board, repo, root, project } = await setup();
    git(repo, "remote", "set-url", "origin", join(root, "gone.git"));
    const free = board.createCard(project.id, { title: "free", description: "" }).id;
    await board.startCard(free);
    const card = await cardWhen(board, free, (c) => c.worktreePath !== null);
    expect(card?.notice).toBeNull();
  });
});
