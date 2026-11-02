import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { shellCommand } from "../src/board/setup.ts";
import type { StartOptions } from "../src/runtime/types.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { must } from "./helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup(setupScript?: string, baseBranch?: string) {
  const ctx = newBoard();
  boards.push(ctx.board);
  const project = await ctx.board.addProject({
    path: ctx.repo,
    ...(setupScript ? { setupScript } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  });
  // Records, for every session start, whether the setup's file already existed in its cwd.
  const prepared: boolean[] = [];
  const start = ctx.runtime.start.bind(ctx.runtime);
  ctx.runtime.start = (opts: StartOptions) => {
    prepared.push(existsSync(join(opts.cwd, "preparado.txt")));
    return start(opts);
  };
  return { ...ctx, project, prepared };
}

describe("preparacao", () => {
  test("o script cadastrado roda na worktree antes da sessão", async () => {
    const { board, project, repo, prepared } = await setup("echo pronto> preparado.txt");
    const card = board.createCard(project.id, { title: "Com preparo", description: "d" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(started).not.toBeNull();
    const file = join(must(started?.worktreePath, "worktreePath"), "preparado.txt");
    expect(existsSync(file) ? readFileSync(file, "utf8").trim() : "").toBe("pronto");
    expect(existsSync(join(repo, "preparado.txt"))).toBe(false);
    expect(prepared).toEqual([true]);
    expect(started?.notice).toBeNull();
  });

  test("sem script cadastrado, a sessão abre direto", async () => {
    const { board, project, prepared } = await setup();
    const card = board.createCard(project.id, { title: "Sem preparo", description: "d" });
    await board.startCard(card.id);
    const started = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(started).not.toBeNull();
    expect(prepared).toEqual([false]);
  });

  test("falha do script leva o card para Esperando você com o erro, sem sessão", async () => {
    const { board, project, manager, prepared } = await setup("echo deu ruim 1>&2 && exit 3");
    const card = board.createCard(project.id, { title: "Preparo quebrado", description: "d" });
    await board.startCard(card.id);
    const failed = await cardWhen(board, card.id, (c) => c.notice !== null);
    expect(failed).not.toBeNull();
    expect(failed?.column).toBe("waiting");
    expect(failed?.notice ?? "").toContain("setup script failed (exit 3)");
    expect(failed?.notice ?? "").toContain("deu ruim");
    // The app translates the refusal from its reason; the English detail is for an older app.
    expect(failed?.noticeReason).toBe("setup_failed");
    expect(failed?.noticeParams).toMatchObject({ code: 3 });
    expect(String(failed?.noticeParams?.output)).toContain("deu ruim");
    // The run that ended on it says the same, for the run's own screen.
    const run = board.workflows.getRun(failed?.runs[0]?.id as string);
    expect(run.reasonKey).toBe("setup_failed");
    expect(failed?.sessionId).toBeNull();
    expect(failed?.runs[0]?.endedAt).not.toBeNull();
    expect(manager.list()).toEqual([]);
    expect(prepared).toEqual([]);
  });

  test("a notice that is replaced or cleared takes its reason with it", async () => {
    const { board, project, store } = await setup("exit 3");
    const card = board.createCard(project.id, { title: "Preparo quebrado", description: "d" });
    await board.startCard(card.id);
    await cardWhen(board, card.id, (c) => c.noticeReason === "setup_failed");
    store.db.query("UPDATE cards SET notice = 'outro aviso' WHERE id = ?").run(card.id);
    expect(board.getCard(card.id)).toMatchObject({
      notice: "outro aviso",
      noticeReason: null,
      noticeParams: null,
    });
  });

  test("falha ao criar a worktree também vai para Esperando você com o erro do git", async () => {
    const { board, project, manager } = await setup(undefined, "nao-existe");
    const card = board.createCard(project.id, { title: "Base errada", description: "d" });
    await board.startCard(card.id);
    const failed = await cardWhen(board, card.id, (c) => c.notice !== null);
    expect(failed).not.toBeNull();
    expect(failed?.column).toBe("waiting");
    expect(failed?.notice ?? "").toContain("git worktree add");
    expect(failed?.worktreePath).toBeNull();
    expect(manager.list()).toEqual([]);
  });
});

describe("preparacao: shell", () => {
  test("cmd.exe /d /s /c no Windows, sh -c nos demais", () => {
    const comspec = process.env.ComSpec;
    process.env.ComSpec = "C:WindowsSystem32cmd.exe";
    try {
      expect(shellCommand("bun install", "win32")).toEqual([
        "C:WindowsSystem32cmd.exe",
        "/d",
        "/s",
        "/c",
        "bun install",
      ]);
    } finally {
      process.env.ComSpec = comspec;
    }
    expect(shellCommand("bun install", "linux")).toEqual(["sh", "-c", "bun install"]);
    expect(shellCommand("bun install", "darwin")).toEqual(["sh", "-c", "bun install"]);
  });
});
