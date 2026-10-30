import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import type { BoardOptions } from "../src/board/board.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";

// Real git and fake CLIs (each one a Bun process) in several waits: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

const VIEW = "state,statusCheckRollup";

/** A card in Em revisão with an open PR on the fake `gh`, polled every 30 ms. */
async function cardWithPr(overrides: Partial<BoardOptions> = {}) {
  const gh = installFakeCli("gh", [
    { args: ["view", "url"], code: 1 },
    { args: ["pr", "create"], stdout: "https://github.com/acme/repo/pull/9\n" },
    { args: ["view", VIEW], stdout: JSON.stringify({ state: "OPEN" }) },
  ]);
  cleanups.push(gh.restore);
  const ctx = newBoard({ prPollIntervalMs: 30, ...overrides });
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: "github",
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "Mesclar", description: "faça" });
  await ctx.board.startCard(card.id);
  const reviewed = await cardWhen(ctx.board, card.id, (c) => c.column === "review");
  expect(reviewed).not.toBeNull();
  git(ctx.root, "init", "-q", "--bare", "remote.git");
  git(ctx.repo, "remote", "add", "origin", join(ctx.root, "remote.git"));
  await ctx.board.createPr(card.id);
  const views = () => gh.calls().filter((args) => args.includes(VIEW)).length;
  return { ...ctx, gh, card, views, worktree: reviewed?.worktreePath ?? "" };
}

describe("board", () => {
  test("a merged card whose worktree removal failed is finished on a later round, without asking the PR host again", async () => {
    const { board, card, repo, gh, views, worktree } = await cardWithPr();
    // A locked worktree makes `git worktree remove` fail, as a busy folder does on Windows.
    git(repo, "worktree", "lock", worktree);
    gh.respond([{ args: ["view", VIEW], stdout: JSON.stringify({ state: "MERGED" }) }]);
    const failed = await cardWhen(board, card.id, (c) =>
      (c.notice ?? "").includes("git worktree remove"),
    );
    expect(failed ?? {}).toMatchObject({
      column: "done",
      prState: "merged",
      worktreePath: worktree,
    });
    const asked = views();
    git(repo, "worktree", "unlock", worktree);
    const done = await cardWhen(board, card.id, (c) => c.worktreePath === null);
    expect(done ?? {}).toMatchObject({ column: "done", prState: "merged", notice: null });
    expect(existsSync(worktree)).toBe(false);
    expect(views()).toBe(asked);
  });

  test("a merged card with pending changes is not finished again on each round", async () => {
    const { board, card, gh, worktree } = await cardWithPr();
    await Bun.write(join(worktree, "solto.txt"), "não rastreado\n");
    gh.respond([{ args: ["view", VIEW], stdout: JSON.stringify({ state: "MERGED" }) }]);
    const kept = await cardWhen(board, card.id, (c) =>
      (c.notice ?? "").includes("alterações pendentes"),
    );
    expect(kept ?? {}).toMatchObject({ column: "done", worktreePath: worktree });
    let changes = 0;
    const unwatch = board.watch((c) => {
      if (c.id === card.id) changes++;
    });
    cleanups.push(unwatch);
    await Bun.sleep(300);
    expect(changes).toBe(0);
  });

  test("the worktree is removed only after the injected idle() settles", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waited = 0;
    const idle = () => {
      waited++;
      return gate;
    };
    const { board, card, gh, worktree } = await cardWithPr({ idle });
    gh.respond([{ args: ["view", VIEW], stdout: JSON.stringify({ state: "MERGED" }) }]);
    const asked = await poll(() => waited > 0 || null, 3000);
    expect(asked).toBe(true);
    await Bun.sleep(200);
    expect(existsSync(worktree)).toBe(true);
    release();
    const done = await cardWhen(board, card.id, (c) => c.worktreePath === null);
    expect(done ?? {}).toMatchObject({ column: "done", notice: null });
    expect(existsSync(worktree)).toBe(false);
  });
});
