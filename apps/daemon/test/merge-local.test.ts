import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Changes } from "../src/review/changes.ts";
import { startServer } from "../src/server.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real git in temp repositories, several worktrees per test: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "merge-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Writes and commits a file in `cwd`. */
function commit(cwd: string, file: string, text: string, message = `muda ${file}`) {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
}

const sha = (cwd: string, ref = "HEAD") => git(cwd, "rev-parse", ref);
const clean = (cwd: string) => git(cwd, "status", "--porcelain") === "";

/** A board, its project and a card started and idle, with the card's worktree. */
async function ready(title = "Integrar", description = "oi", base?: string) {
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
    worktree: started?.worktreePath ?? "",
    branch: started?.branch ?? "",
  };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string; message?: string }) => error.code ?? "sem código",
  );

const message = (promise: Promise<unknown>) =>
  promise.then(
    () => "",
    (error: { message?: string }) => error.message ?? "",
  );

describe("merge-local", () => {
  test("à frente e atrás da base no changes.get do card", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "a.txt", "a\n");
    commit(ctx.worktree, "b.txt", "b\n");
    commit(ctx.repo, "c.txt", "c\n");
    const changes = new Changes({ db: ctx.store.db, board: ctx.board });
    expect((await changes.get(`card:${ctx.cardId}`)).position).toEqual({ ahead: 2, behind: 1 });
  });

  test("atualizar com a base: rebase que preserva a mudança não commitada; conflito aborta e deixa como estava", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "a.txt", "a\n");
    commit(ctx.repo, "c.txt", "c\n");
    writeFileSync(join(ctx.worktree, "pendente.txt"), "ainda não commitado\n");
    writeFileSync(join(ctx.worktree, "README.md"), "# repo\nmudança sem commit\n");
    await ctx.board.updateFromBase(ctx.cardId);
    expect(git(ctx.worktree, "rev-list", "--left-right", "--count", "main...HEAD")).toBe("0\t1");
    expect(readFileSync(join(ctx.worktree, "README.md"), "utf8")).toBe(
      "# repo\nmudança sem commit\n",
    );
    expect(existsSync(join(ctx.worktree, "pendente.txt"))).toBe(true);
    // Same line on both sides: the rebase cannot go through.
    git(ctx.worktree, "checkout", "--", "README.md");
    commit(ctx.worktree, "README.md", "# do card\n");
    commit(ctx.repo, "README.md", "# da base\n");
    writeFileSync(join(ctx.worktree, "pendente.txt"), "mudou de novo\n");
    const before = sha(ctx.worktree);
    const refused = await message(ctx.board.updateFromBase(ctx.cardId));
    expect(refused).toContain("README.md");
    expect(sha(ctx.worktree)).toBe(before);
    expect(readFileSync(join(ctx.worktree, "pendente.txt"), "utf8")).toBe("mudou de novo\n");
    const rebasing = git(ctx.worktree, "rev-parse", "--git-path", "rebase-merge");
    expect(existsSync(resolve(ctx.worktree, rebasing))).toBe(false);
  });

  test("merge --no-ff na base em checkout limpo: commit de merge, git status limpo, card concluído sem worktree nem branch", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "feito.txt", "feito\n");
    const card = await ctx.board.mergeLocal(ctx.cardId, "merge", true);
    expect(card).toMatchObject({ column: "done", worktreePath: null, branch: null });
    expect(git(ctx.repo, "rev-list", "--parents", "-n", "1", "main").split(" ")).toHaveLength(3);
    expect(readFileSync(join(ctx.repo, "feito.txt"), "utf8")).toBe("feito\n");
    expect(clean(ctx.repo)).toBe(true);
    expect(existsSync(ctx.worktree)).toBe(false);
    expect(git(ctx.repo, "branch", "--list", ctx.branch)).toBe("");
  });

  test("squash: um commit novo na base com o título do card", async () => {
    const ctx = await ready("Somar números");
    commit(ctx.worktree, "um.txt", "1\n");
    commit(ctx.worktree, "dois.txt", "2\n");
    const before = sha(ctx.repo, "main");
    await ctx.board.mergeLocal(ctx.cardId, "squash", true);
    expect(git(ctx.repo, "rev-list", "--count", `${before}..main`)).toBe("1");
    expect(git(ctx.repo, "log", "-1", "--format=%s", "main")).toBe("Somar números");
    expect(git(ctx.repo, "rev-list", "--parents", "-n", "1", "main").split(" ")).toHaveLength(2);
    expect(clean(ctx.repo)).toBe(true);
  });

  test("base em checkout com mudanças é recusada com a lista; nada muda", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "feito.txt", "feito\n");
    writeFileSync(join(ctx.repo, "README.md"), "# mexido na base\n");
    const before = sha(ctx.repo, "main");
    const refused = await message(ctx.board.mergeLocal(ctx.cardId, "merge", true));
    expect(refused).toContain("README.md");
    expect(sha(ctx.repo, "main")).toBe(before);
    expect(existsSync(ctx.worktree)).toBe(true);
    expect(ctx.board.getCard(ctx.cardId).column).not.toBe("done");
  });

  test("base fora de checkout: merge numa worktree temporária, que some depois", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "feito.txt", "feito\n");
    git(ctx.repo, "switch", "-q", "-c", "outro");
    await ctx.board.mergeLocal(ctx.cardId, "merge", true);
    expect(git(ctx.repo, "ls-tree", "--name-only", "main").split(/\r?\n/)).toContain("feito.txt");
    expect(git(ctx.repo, "branch", "--show-current")).toBe("outro");
    expect(clean(ctx.repo)).toBe(true);
    expect(git(ctx.repo, "worktree", "list").split("\n")).toHaveLength(1);
  });

  test("conflito recusa sem mudar nada", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "README.md", "# do card\n");
    commit(ctx.repo, "README.md", "# da base\n");
    const before = sha(ctx.repo, "main");
    const refused = await message(ctx.board.mergeLocal(ctx.cardId, "squash", true));
    expect(refused).toContain("README.md");
    expect(sha(ctx.repo, "main")).toBe(before);
    expect(clean(ctx.repo)).toBe(true);
    expect(existsSync(ctx.worktree)).toBe(true);
  });

  test("recusas: sem confirmação, com PR, em execução, worktree suja, nada à frente e base que não é branch local", async () => {
    const plain = await ready();
    expect(await code(plain.board.mergeLocal(plain.cardId, "merge", false))).toBe("invalid_state");
    expect(await message(plain.board.mergeLocal(plain.cardId, "merge", true))).toContain("nada");
    commit(plain.worktree, "feito.txt", "feito\n");
    writeFileSync(join(plain.worktree, "sujo.txt"), "x\n");
    expect(await message(plain.board.mergeLocal(plain.cardId, "merge", true))).toContain(
      "sujo.txt",
    );
    plain.store.db
      .query("UPDATE cards SET pr_url = 'https://github.com/a/b/pull/1' WHERE id = ?")
      .run(plain.cardId);
    expect(await message(plain.board.mergeLocal(plain.cardId, "merge", true))).toContain("PR");
    // Waiting for an approval: the agent is still at it.
    const busy = await ready("Ocupado", "[tool] x");
    await cardWhen(busy.board, busy.cardId, (c) => c.sessionStatus === "awaiting_permission");
    commit(busy.worktree, "feito.txt", "feito\n");
    expect(await message(busy.board.mergeLocal(busy.cardId, "merge", true))).toContain("execução");
    expect(await message(busy.board.updateFromBase(busy.cardId))).toContain("execução");
    const gone = await ready("Sem base", "oi", "dev");
    commit(gone.worktree, "feito.txt", "feito\n");
    git(gone.repo, "branch", "-D", "dev");
    expect(await message(gone.board.mergeLocal(gone.cardId, "merge", true))).toContain("dev");
  });

  test("card.updateFromBase e card.mergeLocal pelo protocolo", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "feito.txt", "feito\n");
    commit(ctx.repo, "c.txt", "c\n");
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data("card.updateFromBase", { cardId: ctx.cardId })).toMatchObject({
      id: ctx.cardId,
    });
    expect(git(ctx.worktree, "rev-list", "--left-right", "--count", "main...HEAD")).toBe("0\t1");
    expect(
      await client.data("card.mergeLocal", { cardId: ctx.cardId, mode: "squash", confirm: true }),
    ).toMatchObject({ column: "done" });
  });
});
