import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addWorktree } from "../src/board/worktree.ts";
import { cardWhen, git, gitRepo, newBoard } from "./board-helpers.ts";
import { record } from "./helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup(baseBranch?: string) {
  const ctx = newBoard();
  boards.push(ctx.board);
  const project = await ctx.board.addProject({
    path: ctx.repo,
    ...(baseBranch ? { baseBranch } : {}),
    promptTemplate: "Trabalhe só na worktree.",
  });
  return { ...ctx, project };
}

describe("worktree", () => {
  test("card novo nasce no Backlog, sem branch nem worktree", async () => {
    const { board, project } = await setup();
    const card = board.createCard(project.id, { title: "Corrigir login", description: "d" });
    expect(card).toMatchObject({
      projectId: project.id,
      title: "Corrigir login",
      description: "d",
      column: "backlog",
      branch: null,
      worktreePath: null,
      sessionId: null,
    });
    expect(board.getCard(card.id).id).toBe(card.id);
  });

  test("iniciar cria a branch fd/<slug> e a worktree a partir da base, com sessão na worktree", async () => {
    const { board, repo, project, manager } = await setup();
    const gitignore = readFileSync(join(repo, ".gitignore"), "utf8");
    const card = board.createCard(project.id, {
      title: "Ação: corrigir o Login!",
      description: "Conserte o login.",
    });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(started).not.toBeNull();
    const expectedPath = join(repo, ".flightdeck", "worktrees", "acao-corrigir-o-login");
    expect(started?.slug).toBe("acao-corrigir-o-login");
    expect(started?.branch).toBe("fd/acao-corrigir-o-login");
    expect(started?.worktreePath).toBe(expectedPath);
    expect(existsSync(join(expectedPath, "README.md"))).toBe(true);
    expect(git(expectedPath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fd/acao-corrigir-o-login");
    expect(git(expectedPath, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "main"));
    // Only the worktrees are excluded locally (phase 5 versions .flightdeck/workflows); the
    // project's .gitignore is not touched.
    const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.split(/\r?\n/)).toContain(".flightdeck/worktrees/");
    expect(exclude.split(/\r?\n/)).not.toContain(".flightdeck/");
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(gitignore);
    expect(git(repo, "status", "--porcelain")).toBe("");
    mkdirSync(join(repo, ".flightdeck", "workflows"));
    writeFileSync(join(repo, ".flightdeck", "workflows", "fluxo.yaml"), "etapas: []\n");
    expect(git(repo, "status", "--porcelain", "-uall")).toBe("?? .flightdeck/workflows/fluxo.yaml");
    // The session runs in the worktree with the description plus the project template.
    const session = manager.get(started?.sessionId ?? "");
    expect(session.cwd).toBe(expectedPath);
    const events = record(manager, session.id);
    expect(events.find("message.user")[0]?.text).toBe(
      "Conserte o login.\n\nTrabalhe só na worktree.",
    );
    events.unsubscribe();
  });

  test("a base vem do projeto, não do HEAD do repositório", async () => {
    const { board, repo, project } = await setup("develop");
    git(repo, "checkout", "-q", "-b", "develop");
    writeFileSync(join(repo, "develop.txt"), "só na develop\n");
    git(repo, "add", "develop.txt");
    git(repo, "commit", "-q", "-m", "develop");
    git(repo, "checkout", "-q", "main");
    const card = board.createCard(project.id, { title: "Na develop", description: "d" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.worktreePath !== null);
    expect(started).not.toBeNull();
    const path = started?.worktreePath ?? "";
    expect(existsSync(join(path, "develop.txt"))).toBe(true);
    expect(git(path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "develop"));
  });

  test("títulos iguais ganham slugs distintos e o exclude não repete a linha", async () => {
    const { board, repo, project } = await setup();
    const a = board.createCard(project.id, { title: "Mesmo título", description: "a" });
    const b = board.createCard(project.id, { title: "Mesmo título", description: "b" });
    const c = board.createCard(project.id, { title: "!!!", description: "c" });
    await board.startCard(a.id);
    expect(await cardWhen(board, a.id, (x) => x.sessionId !== null)).not.toBeNull();
    await board.startCard(b.id);
    expect(await cardWhen(board, b.id, (x) => x.sessionId !== null)).not.toBeNull();
    await board.startCard(c.id);
    expect(await cardWhen(board, c.id, (x) => x.sessionId !== null)).not.toBeNull();
    expect(board.getCard(a.id).branch).toBe("fd/mesmo-titulo");
    expect(board.getCard(b.id).branch).toBe("fd/mesmo-titulo-2");
    expect(board.getCard(c.id).branch).toBe("fd/card");
    const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.split(/\r?\n/).filter((l) => l === ".flightdeck/worktrees/")).toHaveLength(1);
  });

  test("card ou projeto inexistente é not_found", async () => {
    const { board } = await setup();
    const codes: string[] = [];
    for (const action of [
      () => board.getCard("nao-existe"),
      () => board.createCard("nao-existe", { title: "t", description: "d" }),
    ]) {
      try {
        action();
        codes.push("aceitou");
      } catch (error) {
        codes.push((error as { code: string }).code);
      }
    }
    expect(codes).toEqual(["not_found", "not_found"]);
  });
});

describe("worktree: falhas do git", () => {
  test("base inexistente: o erro do git chega a quem iniciou e nenhuma branch fica para trás", async () => {
    const { repo } = gitRepo();
    const result = await addWorktree(repo, "Sem base", "nao-existe").then(
      () => "criou",
      (error: { code?: string; message?: string }) => `${error.code}: ${error.message}`,
    );
    expect(result.startsWith("invalid_state: git worktree add: ")).toBe(true);
    expect(git(repo, "branch", "--list", "fd/*")).toBe("");
  });
});
