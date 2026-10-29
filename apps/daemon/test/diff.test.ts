import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseUnifiedDiff } from "../src/board/diff.ts";
import type { DiffFile } from "../src/board/types.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function startedCard() {
  const ctx = newBoard();
  boards.push(ctx.board);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Diff", description: "faça" });
  await ctx.board.startCard(card.id);
  const started = await cardWhen(ctx.board, card.id, (c) => c.column === "review");
  return { ...ctx, card, worktree: started?.worktreePath ?? "" };
}

const byPath = (files: DiffFile[], path: string) => files.find((f) => f.path === path);

describe("diff", () => {
  test("inclui commits desde a base e alterações não commitadas, por arquivo", async () => {
    const { board, card, repo, worktree } = await startedCard();
    expect(worktree).not.toBe("");
    // Committed by the agent.
    appendFileSync(join(worktree, "README.md"), "segunda linha\n");
    mkdirSync(join(worktree, "src"));
    writeFileSync(join(worktree, "src", "novo.ts"), "export const x = 1;\nexport const y = 2;\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "trabalho do agente");
    // Not committed: a tracked change and a new file.
    writeFileSync(join(worktree, ".gitignore"), "dist/\n");
    writeFileSync(join(worktree, "rascunho.txt"), "ideia\n");
    // Moves on the base after the branch was created stay out (`<base>...HEAD`).
    writeFileSync(join(repo, "na-base.txt"), "base\n");
    git(repo, "add", "na-base.txt");
    git(repo, "commit", "-q", "-m", "base andou");

    const diff = await board.diff(card.id);
    expect(diff.base).toBe("main");
    expect(diff.files.map((f) => `${f.path}:${f.status}:${f.uncommitted}`).sort()).toEqual([
      ".gitignore:modified:true",
      "README.md:modified:false",
      "rascunho.txt:added:true",
      "src/novo.ts:added:false",
    ]);
    const readme = byPath(diff.files, "README.md");
    expect(readme).toMatchObject({ additions: 1, deletions: 0, binary: false });
    expect(readme?.hunks[0]?.header.startsWith("@@ ")).toBe(true);
    expect(readme?.hunks[0]?.lines).toEqual([
      { op: " ", text: "# repo" },
      { op: "+", text: "segunda linha" },
    ]);
    expect(byPath(diff.files, "src/novo.ts")).toMatchObject({ additions: 2, deletions: 0 });
    expect(byPath(diff.files, ".gitignore")).toMatchObject({ additions: 1, deletions: 1 });
    expect(byPath(diff.files, "rascunho.txt")?.hunks[0]?.lines).toEqual([
      { op: "+", text: "ideia" },
    ]);
  });

  test("card sem worktree não tem diff", async () => {
    const ctx = newBoard();
    boards.push(ctx.board);
    const project = await ctx.board.addProject({ path: ctx.repo });
    const card = ctx.board.createCard(project.id, { title: "Nunca iniciado", description: "d" });
    const result = await ctx.board.diff(card.id).then(
      () => "veio diff",
      (error: { code?: string }) => error.code,
    );
    expect(result).toBe("invalid_state");
  });

  test("renomeado, apagado, binário e arquivo sem quebra de linha no fim", () => {
    const text = [
      "diff --git a/velho.txt b/novo.txt",
      "similarity index 90%",
      "rename from velho.txt",
      "rename to novo.txt",
      "index 1111111..2222222 100644",
      "--- a/velho.txt",
      "+++ b/novo.txt",
      "@@ -1,2 +1,2 @@",
      " igual",
      "-antes",
      "+depois",
      "\\ No newline at end of file",
      "diff --git a/some.txt b/some.txt",
      "deleted file mode 100644",
      "index 3333333..0000000",
      "--- a/some.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-tchau",
      "diff --git a/logo.png b/logo.png",
      "new file mode 100644",
      "index 0000000..4444444",
      "Binary files /dev/null and b/logo.png differ",
      "diff --git a/so-renomeado.txt b/outro nome.txt",
      "similarity index 100%",
      "rename from so-renomeado.txt",
      "rename to outro nome.txt",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(text, false);
    expect(files.map((f) => [f.path, f.oldPath, f.status, f.additions, f.deletions])).toEqual([
      ["novo.txt", "velho.txt", "renamed", 1, 1],
      ["some.txt", null, "deleted", 0, 1],
      ["logo.png", null, "added", 0, 0],
      ["outro nome.txt", "so-renomeado.txt", "renamed", 0, 0],
    ]);
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { op: " ", text: "igual" },
      { op: "-", text: "antes" },
      { op: "+", text: "depois" },
    ]);
    expect(files[2]?.binary).toBe(true);
    expect(files[2]?.hunks).toEqual([]);
    expect(parseUnifiedDiff("", true)).toEqual([]);
  });

  test("arquivo novo binário fora do git aparece sem linhas", async () => {
    const { board, card, worktree } = await startedCard();
    writeFileSync(join(worktree, "imagem.bin"), Buffer.from([0, 1, 2, 0, 255]));
    const diff = await board.diff(card.id);
    expect(byPath(diff.files, "imagem.bin") ?? {}).toMatchObject({
      status: "added",
      binary: true,
      uncommitted: true,
      hunks: [],
    });
  });
});
