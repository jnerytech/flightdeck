import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Changes } from "../src/review/changes.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { startServer } from "../src/server.ts";
import { cardWhen, git, gitRepo, newBoard } from "./board-helpers.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertSession } from "./usage-helpers.ts";

// Real git in temp repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "files-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** A repository inside the allowed root, a session on it and files on a manual clock. */
function setup() {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.txt"), "original\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  let now = Date.UTC(2026, 9, 1, 12);
  const dataDir = tempDir("fd-data-");
  const files = new ReviewFiles({
    changes: new Changes({ db: ctx.store.db }),
    dataDir,
    allowedRoots: [ctx.root],
    now: () => now,
  });
  return { ...ctx, repo, dataDir, files, move: (ms: number) => (now += ms) };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code ?? "sem código",
  );

const status = (repo: string) => git(repo, "status", "--porcelain").trim();

/** A file's text, or `null` when it does not exist (so a missing file fails an assertion). */
const contentOf = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

describe("reverter-editar", () => {
  test("reverter arquivo rastreado volta ao HEAD, guarda cópia e desfazer em 30 s recupera", async () => {
    const { files, repo, dataDir } = setup();
    writeFileSync(join(repo, "a.txt"), "mudado\n");
    expect(await code(files.revert("session:s-1", "a.txt", false))).toBe("invalid_state");
    expect(await files.revert("session:s-1", "a.txt", true)).toEqual({
      path: "a.txt",
      undoUntil: "2026-10-01T12:00:30.000Z",
    });
    expect(contentOf(join(repo, "a.txt"))).toBe("original\n");
    expect(status(repo)).toBe("");
    const trash = join(dataDir, "review-trash");
    const [copy] = readdirSync(trash);
    expect(contentOf(join(trash, copy ?? "", "a.txt"))).toBe("mudado\n");
    expect(await files.undoRevert("session:s-1", "a.txt", true)).toEqual({ path: "a.txt" });
    expect(contentOf(join(repo, "a.txt"))).toBe("mudado\n");
  });

  test("arquivo novo é removido e o desfazer o traz de volta; depois de 30 s não há desfazer", async () => {
    const { files, repo, move } = setup();
    mkdirSync(join(repo, "dir"));
    writeFileSync(join(repo, "dir", "novo.txt"), "novo\n");
    await files.revert("session:s-1", "dir/novo.txt", true);
    expect(existsSync(join(repo, "dir", "novo.txt"))).toBe(false);
    await files.undoRevert("session:s-1", "dir/novo.txt", true);
    expect(contentOf(join(repo, "dir", "novo.txt"))).toBe("novo\n");
    await files.revert("session:s-1", "dir/novo.txt", true);
    move(30_001);
    expect(await code(files.undoRevert("session:s-1", "dir/novo.txt", true))).toBe("invalid_state");
    expect(await code(files.undoRevert("session:s-1", "a.txt", true))).toBe("invalid_state");
    expect(await code(files.undoRevert("session:s-1", "a.txt", false))).toBe("invalid_state");
  });

  test("um arquivo apagado volta com o revert, e o desfazer o apaga de novo", async () => {
    const { files, repo } = setup();
    git(repo, "rm", "-q", "a.txt");
    await files.revert("session:s-1", "a.txt", true);
    expect(contentOf(join(repo, "a.txt"))).toBe("original\n");
    await files.undoRevert("session:s-1", "a.txt", true);
    expect(existsSync(join(repo, "a.txt"))).toBe(false);
  });

  test("no card, o revert volta à base: o que o card mudou e o que ele criou num commit", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Desfazer", description: "oi" });
    await ctx.board.startCard(card.id);
    const started = await cardWhen(ctx.board, card.id, (c) => c.worktreePath !== null);
    const worktree = started?.worktreePath ?? "";
    writeFileSync(join(worktree, "README.md"), "# mudado\n");
    writeFileSync(join(worktree, "criado.txt"), "criado\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", "mudanças do card");
    const files = new ReviewFiles({
      changes: new Changes({ db: ctx.store.db, board: ctx.board }),
      dataDir: tempDir("fd-data-"),
      allowedRoots: [ctx.root],
    });
    await files.revert(`card:${card.id}`, "README.md", true);
    await files.revert(`card:${card.id}`, "criado.txt", true);
    expect(contentOf(join(worktree, "README.md"))).toBe("# repo\n");
    expect(existsSync(join(worktree, "criado.txt"))).toBe(false);
  });

  test("cópias com mais de 7 dias saem da lixeira no revert seguinte", async () => {
    const { files, repo, dataDir } = setup();
    const old = join(dataDir, "review-trash", "antiga");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "x.txt"), "x");
    const eightDays = (Date.UTC(2026, 9, 1, 12) - 8 * 86_400_000) / 1000;
    utimesSync(old, eightDays, eightDays);
    writeFileSync(join(repo, "a.txt"), "mudado\n");
    await files.revert("session:s-1", "a.txt", true);
    expect(existsSync(old)).toBe(false);
    expect(readdirSync(join(dataDir, "review-trash"))).toHaveLength(1);
  });

  test("editar: lê com hash, grava só com o hash esperado; arquivo que mudou é conflito", async () => {
    const { files, repo } = setup();
    expect(await files.read("session:s-1", "a.txt")).toEqual({
      path: "a.txt",
      text: "original\n",
      hash: sha("original\n"),
      size: 9,
    });
    expect(await files.write("session:s-1", "a.txt", "editado\n", sha("original\n"))).toEqual({
      path: "a.txt",
      hash: sha("editado\n"),
      size: 8,
    });
    expect(contentOf(join(repo, "a.txt"))).toBe("editado\n");
    writeFileSync(join(repo, "a.txt"), "o agente mexeu\n");
    expect(await code(files.write("session:s-1", "a.txt", "meu\n", sha("editado\n")))).toBe(
      "file_conflict",
    );
    expect(contentOf(join(repo, "a.txt"))).toBe("o agente mexeu\n");
  });

  test("só texto até 1 MB; nada fora do repositório; escrita e revert só dentro de allowedRoots", async () => {
    const { files, repo, store } = setup();
    writeFileSync(join(repo, "img.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(join(repo, "grande.txt"), "x".repeat(1024 * 1024 + 1));
    expect(await code(files.read("session:s-1", "img.bin"))).toBe("bad_request");
    expect(await code(files.read("session:s-1", "grande.txt"))).toBe("bad_request");
    expect(await code(files.read("session:s-1", "nada.txt"))).toBe("not_found");
    expect(await code(files.read("session:s-1", "../fora.txt"))).toBe("bad_request");
    const big = "y".repeat(1024 * 1024 + 1);
    expect(await code(files.write("session:s-1", "a.txt", big, sha("original\n")))).toBe(
      "bad_request",
    );
    // A terminal session outside allowedRoots: its diff and files can be read, not changed.
    const { repo: outside } = gitRepo("fora");
    insertSession(store.db, "m-2", "s-2", outside);
    expect((await files.read("session:s-2", "README.md")).text).toBe("# repo\n");
    expect(await code(files.revert("session:s-2", "README.md", true))).toBe("forbidden_cwd");
    expect(await code(files.write("session:s-2", "README.md", "x", sha("# repo\n")))).toBe(
      "forbidden_cwd",
    );
    // A link inside the repository that points out of it is refused too (where links work).
    let linked = true;
    try {
      symlinkSync(join(outside, "README.md"), join(repo, "link.md"));
    } catch {
      linked = false;
    }
    if (linked) {
      expect(await code(files.write("session:s-1", "link.md", "x", sha("# repo\n")))).toBe(
        "forbidden_cwd",
      );
    }
  });

  test("changes.revert, changes.undoRevert, file.read e file.write pelo protocolo, com o erro file_conflict", async () => {
    const ctx = setup();
    const server = startServer({
      manager: ctx.manager,
      files: ctx.files,
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
    const target = "session:s-1";
    const read = await client.data<{ hash: string }>("file.read", { target, path: "a.txt" });
    expect(read?.hash).toBe(sha("original\n"));
    const stale = await client.request("file.write", {
      target,
      path: "a.txt",
      text: "x",
      expectedHash: "0".repeat(64),
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "file_conflict" } });
    await client.request("file.write", {
      target,
      path: "a.txt",
      text: "novo\n",
      expectedHash: read?.hash,
    });
    expect(
      await client.data("changes.revert", { target, path: "a.txt", confirm: true }),
    ).toMatchObject({
      path: "a.txt",
    });
    expect(contentOf(join(ctx.repo, "a.txt"))).toBe("original\n");
    expect(
      await client.data("changes.undoRevert", { target, path: "a.txt", confirm: true }),
    ).toEqual({
      path: "a.txt",
    });
    expect(contentOf(join(ctx.repo, "a.txt"))).toBe("novo\n");
  });
});
