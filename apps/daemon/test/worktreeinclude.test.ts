import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardOptions } from "../src/board/board.ts";
import { copyIncluded, WORKTREE_INCLUDE_LIMIT } from "../src/board/worktree.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

// Real git in temp repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

/** A board whose repo's .gitignore hides secrets, dependencies and a .flightdeck file. */
function boardWithSecrets(include: string | null, overrides: Partial<BoardOptions> = {}) {
  const ctx = newBoard(overrides);
  cleanups.push(() => ctx.board.stop());
  const { repo } = ctx;
  writeFileSync(
    join(repo, ".gitignore"),
    "node_modules/\n.env\n*.secret.json\n.flightdeck/segredo\nbig/\n",
  );
  write(join(repo, ".env.example"), "TOKEN=\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "ignora segredos");
  write(join(repo, ".env"), "TOKEN=abc\n");
  write(join(repo, "config", "db.secret.json"), "{}\n");
  write(join(repo, "notes.txt"), "não ignorado\n");
  write(join(repo, "node_modules", "x.js"), "x\n");
  write(join(repo, ".flightdeck", "segredo"), "fora\n");
  if (include !== null) writeFileSync(join(repo, ".worktreeinclude"), include);
  return ctx;
}

/** A card started on the board's repo, and its worktree. */
async function started(ctx: ReturnType<typeof boardWithSecrets>) {
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Segredos", description: "oi" });
  await ctx.board.startCard(card.id);
  const done = await cardWhen(ctx.board, card.id, (c) => c.worktreePath !== null);
  return { project, card: done, worktree: done?.worktreePath ?? ctx.root };
}

describe("worktreeinclude", () => {
  test("copia só os ignorados que casam com os padrões; nunca .git nem .flightdeck", async () => {
    const ctx = boardWithSecrets(".env*\nconfig/*.secret.json\nnotes.txt\n.flightdeck/*\n.git/*\n");
    const { worktree, card } = await started(ctx);
    const has = (path: string) => existsSync(join(worktree, path));
    expect(has(".env") ? readFileSync(join(worktree, ".env"), "utf8") : null).toBe("TOKEN=abc\n");
    expect(has("config/db.secret.json")).toBe(true);
    // Tracked files come with the worktree; untracked ones that git does not ignore stay out.
    expect(has(".env.example")).toBe(true);
    expect(has("notes.txt")).toBe(false);
    expect(has("node_modules/x.js")).toBe(false);
    expect(has(".flightdeck/segredo")).toBe(false);
    expect(card?.notice).toBeNull();
  });

  test("settings.local.json da raiz é um padrão embutido, mesmo sem .worktreeinclude", async () => {
    const ctx = boardWithSecrets(null);
    write(join(ctx.repo, ".claude", "settings.local.json"), '{"permissions":{}}\n');
    const { worktree } = await started(ctx);
    expect(existsSync(join(worktree, ".claude", "settings.local.json"))).toBe(true);
    expect(existsSync(join(worktree, ".env"))).toBe(false);
  });

  test("limite total (50 MB por padrão): copia até ele e avisa no card", async () => {
    expect(WORKTREE_INCLUDE_LIMIT).toBe(50 * 1024 * 1024);
    const ctx = boardWithSecrets("big/*\n", { worktreeIncludeLimit: 1000 });
    write(join(ctx.repo, "big", "a.bin"), "a".repeat(600));
    write(join(ctx.repo, "big", "b.bin"), "b".repeat(600));
    const { worktree, card } = await started(ctx);
    expect(existsSync(join(worktree, "big", "a.bin"))).toBe(true);
    expect(existsSync(join(worktree, "big", "b.bin"))).toBe(false);
    expect(card?.notice ?? "").toContain("1 arquivo do .worktreeinclude não copiado");
  });

  test("copyIncluded devolve o que copiou e o que deixou de fora", async () => {
    const { repo, root } = boardWithSecrets(".env\nbig/*\n");
    write(join(repo, "big", "a.bin"), "a".repeat(10));
    const target = join(root, "copia");
    mkdirSync(target);
    expect(await copyIncluded(repo, target, 12)).toEqual({
      copied: [".env"],
      skipped: ["big/a.bin"],
    });
  });

  test("o projeto diz se tem .worktreeinclude, para o app avisar quando falta", async () => {
    const withFile = boardWithSecrets(".env\n");
    const without = boardWithSecrets(null);
    const one = await withFile.board.addProject({ path: withFile.repo, promptTemplate: "" });
    const two = await without.board.addProject({ path: without.repo, promptTemplate: "" });
    expect([one.worktreeInclude, two.worktreeInclude]).toEqual([true, false]);
  });
});
