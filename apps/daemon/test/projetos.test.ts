import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PROMPT_TEMPLATE } from "../src/board/board.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

function setup() {
  const ctx = newBoard();
  boards.push(ctx.board);
  return ctx;
}

describe("projetos", () => {
  test("cadastra um repositório git dentro de allowedRoots com os padrões", async () => {
    const { board, repo } = setup();
    const project = await board.addProject({ path: repo });
    expect(project.path).toBe(repo);
    expect(project.name).toBe("repo");
    expect(project.baseBranch).toBe("main");
    expect(project.prProvider).toBe("none");
    expect(project.setupScript).toBeNull();
    expect(project.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE);
    expect(board.listProjects().map((p) => p.id)).toEqual([project.id]);
  });

  test("o modelo padrão pede para trabalhar só na worktree e fazer commits descritivos", () => {
    expect(DEFAULT_PROMPT_TEMPLATE).toContain("worktree");
    expect(DEFAULT_PROMPT_TEMPLATE).toContain("commits");
  });

  test("aceita nome, branch base, provedor, script e modelo informados", async () => {
    const { board, repo } = setup();
    const project = await board.addProject({
      path: repo,
      name: "Meu repo",
      baseBranch: "develop",
      prProvider: "github",
      setupScript: "bun install",
      promptTemplate: "Siga o guia.",
    });
    expect(project).toMatchObject({
      name: "Meu repo",
      baseBranch: "develop",
      prProvider: "github",
      setupScript: "bun install",
      promptTemplate: "Siga o guia.",
    });
  });

  test("recusa caminho fora de allowedRoots", async () => {
    const { board } = setup();
    const outside = tempDir("fd-fora-");
    const result = await board.addProject({ path: outside }).then(
      () => "aceitou",
      (error: { code?: string }) => error.code,
    );
    expect(result).toBe("forbidden_cwd");
    expect(board.listProjects()).toEqual([]);
  });

  test("recusa pasta que não é repositório git", async () => {
    const { board, root } = setup();
    const plain = join(root, "sem-git");
    mkdirSync(plain);
    const result = await board.addProject({ path: plain }).then(
      () => "aceitou",
      (error: { code?: string; message?: string }) => `${error.code}: ${error.message}`,
    );
    expect(result).toBe(`invalid_state: não é um repositório git: ${plain}`);
    expect(board.listProjects()).toEqual([]);
  });

  test("recusa o mesmo repositório duas vezes", async () => {
    const { board, repo } = setup();
    await board.addProject({ path: repo });
    const result = await board.addProject({ path: repo }).then(
      () => "aceitou",
      (error: { code?: string }) => error.code,
    );
    expect(result).toBe("invalid_state");
    expect(board.listProjects()).toHaveLength(1);
  });

  test("script de preparação só existe se cadastrado, e some quando apagado", async () => {
    const { board, repo } = setup();
    const project = await board.addProject({ path: repo });
    expect(project.setupScript).toBeNull();
    const withScript = board.updateProject(project.id, { setupScript: "bun install" });
    expect(withScript.setupScript).toBe("bun install");
    expect(board.listProjects()[0]?.setupScript).toBe("bun install");
    const cleared = board.updateProject(project.id, { setupScript: "  " });
    expect(cleared.setupScript).toBeNull();
    const renamed = board.updateProject(project.id, { name: "Outro", prProvider: "azure-devops" });
    expect(renamed).toMatchObject({ name: "Outro", prProvider: "azure-devops", setupScript: null });
  });

  test("atualizar projeto inexistente é not_found", () => {
    const { board } = setup();
    let code = "aceitou";
    try {
      board.updateProject("nao-existe", { name: "x" });
    } catch (error) {
      code = (error as { code: string }).code;
    }
    expect(code).toBe("not_found");
  });
});
