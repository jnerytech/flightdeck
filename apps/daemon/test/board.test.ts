import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
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

/** An idle() that holds until `release()`, counting the calls. */
function gatedIdle() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { waited: 0 };
  const idle = () => {
    state.waited++;
    return gate;
  };
  return { idle, state, release: () => release() };
}

/** A card started and idle on a board with `idle`, with its worktree. */
async function idleCard(idle: () => Promise<void>) {
  const ctx = newBoard({ idle });
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Esperar", description: "faça" });
  await ctx.board.startCard(card.id);
  const started = await cardWhen(
    ctx.board,
    card.id,
    (c) => c.worktreePath !== null && c.sessionStatus === "idle",
  );
  expect(started).not.toBeNull();
  return { ...ctx, card, worktree: started?.worktreePath ?? "" };
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
    // The round that set the notice ends with its own update: count only the rounds after it.
    await Bun.sleep(100);
    let changes = 0;
    const unwatch = board.watch((c) => {
      if (c.id === card.id) changes++;
    });
    cleanups.push(unwatch);
    await Bun.sleep(300);
    expect(changes).toBe(0);
  });

  test("a merged card started again keeps its new worktree and session across rounds", async () => {
    const { board, card, gh, manager } = await cardWithPr();
    gh.respond([{ args: ["view", VIEW], stdout: JSON.stringify({ state: "MERGED" }) }]);
    const done = await cardWhen(board, card.id, (c) => c.column === "done" && !c.worktreePath);
    expect(done).not.toBeNull();
    await board.startCard(card.id);
    const again = await cardWhen(board, card.id, (c) => c.column === "review");
    expect(again?.worktreePath ?? null).not.toBeNull();
    await Bun.sleep(300);
    const later = board.getCard(card.id);
    expect(later.worktreePath).toBe(again?.worktreePath ?? "");
    expect(manager.get(later.sessionId ?? "").status).not.toBe("ended");
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

  test("a local merge removes the worktree only after the injected idle() settles", async () => {
    const { idle, state, release } = gatedIdle();
    const { board, card, worktree } = await idleCard(idle);
    writeFileSync(join(worktree, "feito.txt"), "feito\n");
    git(worktree, "add", "feito.txt");
    git(worktree, "commit", "-q", "-m", "feito");
    const merging = board.mergeLocal(card.id, "merge", true);
    const asked = await poll(() => state.waited > 0 || null, 3000);
    expect(asked).toBe(true);
    await Bun.sleep(200);
    expect(existsSync(worktree)).toBe(true);
    release();
    expect(await merging).toMatchObject({ column: "done", worktreePath: null, notice: null });
    expect(existsSync(worktree)).toBe(false);
  });

  test("discarding a card removes its worktree only after the injected idle() settles", async () => {
    const { idle, state, release } = gatedIdle();
    const { board, card, worktree } = await idleCard(idle);
    const discarding = board.discardCard(card.id, true);
    const asked = await poll(() => state.waited > 0 || null, 3000);
    expect(asked).toBe(true);
    await Bun.sleep(200);
    expect(existsSync(worktree)).toBe(true);
    release();
    expect(await discarding).toMatchObject({ discarded: true, worktreePath: null });
    expect(existsSync(worktree)).toBe(false);
  });

  test("a card still starting when the daemon stops leaves no unhandled error and writes nothing after", async () => {
    // In a process of its own: an unhandled rejection there is output and an exit code to check.
    const script = `
      import { newBoard } from ${JSON.stringify(join(import.meta.dir, "board-helpers.ts"))};
      const { board, store, repo } = newBoard();
      const project = await board.addProject({ path: repo, promptTemplate: "" });
      const card = board.createCard(project.id, { title: "Parar no meio", description: "faça" });
      await board.startCard(card.id);
      // The start (worktree, session) is still in flight: stop as the daemon does, then close.
      board.stop();
      store.close();
      await Bun.sleep(1500);
      console.log("fim");
    `;
    const proc = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).not.toContain("closed database");
    expect({ code, stdout: stdout.trim() }).toEqual({ code: 0, stdout: "fim" });
  });
});
