import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Changes } from "../src/review/changes.ts";
import { ReviewComments, type ReviewCommentsOptions } from "../src/review/comments.ts";
import { startServer } from "../src/server.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { must, newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real git and FakeRuntime turns: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "review-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A repository in the manager's allowed root, `a.txt` changed after the first commit. */
async function session(overrides: Partial<ReviewCommentsOptions> = {}) {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.txt"), "um\ndois\ntrês\nquatro\n");
  writeFileSync(join(repo, "b.txt"), "bê\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  writeFileSync(join(repo, "a.txt"), "um\ndois\ntrês\nquatro\ncinco\n");
  const { sessionId } = await ctx.manager.create({ cwd: repo, prompt: "oi" });
  await poll(() => ctx.manager.get(sessionId).status === "idle");
  const claudeId = ctx.manager.get(sessionId).claudeSessionId as string;
  const changes = new Changes({ db: ctx.store.db });
  const review = new ReviewComments({
    db: ctx.store.db,
    changes,
    manager: ctx.manager,
    now: () => Date.UTC(2026, 9, 1, 12),
    ...overrides,
  });
  return { ...ctx, repo, sessionId, target: `session:${claudeId}`, changes, review };
}

/** Whether a session's conversation has a message containing `text`. */
const received = (
  ctx: { store: { db: import("bun:sqlite").Database } },
  id: string,
  text: string,
) =>
  ctx.store.db
    .query("SELECT 1 FROM events WHERE session_id = ? AND payload LIKE ?")
    .get(id, `%${text}%`) !== null;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code ?? "sem código",
  );

const REVIEW = [
  "Revisão das mudanças:",
  "1. `a.txt` linhas 2–3:",
  "   > dois",
  "   > três",
  "   troque isto",
  "   e aquilo",
  "2. `b.txt` linha 1:",
  "   > bê",
  "   ok?",
].join("\n");

const REVIEW_EN = REVIEW.replace("Revisão das mudanças:", "Review of the changes:")
  .replace("linhas 2–3", "lines 2–3")
  .replace("linha 1", "line 1");

describe("revisao-inline", () => {
  test("comentários em rascunho por alvo, com o trecho lido do arquivo; editar e remover", async () => {
    const { review, target } = await session();
    const first = await review.add({
      target,
      path: "a.txt",
      side: "new",
      lineStart: 2,
      lineEnd: 3,
      body: "troque isto",
    });
    expect(first).toMatchObject({
      target,
      path: "a.txt",
      side: "new",
      lineStart: 2,
      lineEnd: 3,
      quote: "dois\ntrês",
      body: "troque isto",
      state: "draft",
      createdAt: "2026-10-01T12:00:00.000Z",
      sentAt: null,
      outdated: false,
    });
    expect(first.id).not.toBe("");
    // The old side quotes the version the diff compares with (HEAD).
    const old = await review.add({
      target,
      path: "b.txt",
      side: "old",
      lineStart: 1,
      lineEnd: 1,
      body: "ok?",
    });
    expect(old.quote).toBe("bê");
    await review
      .add({
        target: "session:outra",
        path: "a.txt",
        side: "new",
        lineStart: 1,
        lineEnd: 1,
        body: "x",
      })
      .catch(() => null);
    expect((await review.list(target)).map((c) => c.body)).toEqual(["troque isto", "ok?"]);
    expect((await review.update(first.id, "troque isto\ne aquilo"))?.body).toBe(
      "troque isto\ne aquilo",
    );
    review.remove(old.id);
    expect((await review.list(target)).map((c) => c.id)).toEqual([first.id]);
  });

  test("envio pela sessão gerenciada no formato da revisão; enviados ficam marcados", async () => {
    const ctx = await session();
    const { review, target } = ctx;
    await review.add({
      target,
      path: "a.txt",
      side: "new",
      lineStart: 2,
      lineEnd: 3,
      body: "troque isto\ne aquilo",
    });
    await review.add({ target, path: "b.txt", side: "old", lineStart: 1, lineEnd: 1, body: "ok?" });
    expect(await review.send(target, "pt-BR")).toEqual({
      via: "session",
      text: REVIEW,
      comments: 2,
    });
    await poll(() => received(ctx, ctx.sessionId, "Revisão das mudanças:"));
    expect(received(ctx, ctx.sessionId, "Revisão das mudanças:")).toBe(true);
    const listed = await review.list(target);
    expect(listed.map((c) => [c.state, c.sentAt])).toEqual([
      ["sent", "2026-10-01T12:00:00.000Z"],
      ["sent", "2026-10-01T12:00:00.000Z"],
    ]);
    // Nothing left to send; a sent comment is history, not a draft.
    expect(await code(review.send(target))).toBe("invalid_state");
    expect(await code(review.update(listed[0]?.id ?? "", "outro"))).toBe("invalid_state");
  });

  test("a revisão sai em inglês quando o app não diz a língua, e no idioma pedido quando diz", async () => {
    const ctx = await session();
    const { review, target } = ctx;
    const one = {
      path: "a.txt",
      side: "new" as const,
      lineStart: 2,
      lineEnd: 3,
      body: "troque isto\ne aquilo",
    };
    await review.add({ target, ...one });
    await review.add({ target, path: "b.txt", side: "old", lineStart: 1, lineEnd: 1, body: "ok?" });
    expect((await review.send(target)).text).toBe(REVIEW_EN);
    await review.add({ target, ...one });
    expect((await review.send(target, "pt-BR")).text.split("\n")[0]).toBe("Revisão das mudanças:");
  });

  test("terminal controlável recebe pelo canal; não controlável vira Copiar revisão", async () => {
    const sent: Array<[string, string]> = [];
    // A terminal session opened with flightdeckd claude (e-1) has a channel; e-2 has none.
    const ctx = await session({
      central: {
        external: { get: (id: string) => ({ launchId: id === "e-1" ? "launch-1" : null }) },
        receptor: {
          sendToLaunch: (launchId: string, text: string) => {
            sent.push([launchId, text]);
            return true;
          },
        },
      } as unknown as ReviewCommentsOptions["central"],
    });
    for (const id of ["e-1", "e-2"]) {
      ctx.store.db
        .query(
          `INSERT INTO external_sessions (claude_session_id, cwd, status, started_at, last_event_at)
           VALUES (?, ?, 'running', 'x', 'x')`,
        )
        .run(id, ctx.repo);
    }
    const one = { path: "b.txt", side: "old" as const, lineStart: 1, lineEnd: 1, body: "ok?" };
    await ctx.review.add({ target: "session:e-1", ...one });
    await ctx.review.add({ target: "session:e-2", ...one });
    const text = ["Review of the changes:", "1. `b.txt` line 1:", "   > bê", "   ok?"].join("\n");
    expect(await ctx.review.send("session:e-1")).toEqual({ via: "terminal", text, comments: 1 });
    expect(sent).toEqual([["launch-1", text]]);
    expect(await ctx.review.send("session:e-2")).toEqual({ via: "copy", text, comments: 1 });
  });

  test("um alvo de projeto, sem sessão nem card, vira Copiar revisão, mesmo que o canal responda a qualquer id (#806)", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    writeFileSync(join(ctx.repo, "a.txt"), "um\n");
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const sent: string[] = [];
    // A channel that answers for every id, a null one included: only the target decides.
    const review = new ReviewComments({
      db: ctx.store.db,
      changes: new Changes({ db: ctx.store.db, board: ctx.board, allowedRoots: [ctx.root] }),
      manager: {} as ReviewCommentsOptions["manager"],
      central: {
        external: { get: () => ({ launchId: "launch-any" }) },
        receptor: {
          sendToLaunch: (_launch: string, text: string) => {
            sent.push(text);
            return true;
          },
        },
      } as unknown as ReviewCommentsOptions["central"],
    });
    const target = `project:${project.id}`;
    // `add` refuses a project target; a draft left by an older version is what `send` could meet.
    ctx.store.db
      .query(
        `INSERT INTO review_comments (id, target, path, side, line_start, line_end, quote, body,
           state, created_at, sent_at)
         VALUES ('old-1', ?, 'a.txt', 'new', 1, 1, 'um', 'ok?', 'draft', 'x', NULL)`,
      )
      .run(target);
    const outcome = await review.send(target);
    expect([outcome.via, sent]).toEqual(["copy", []]);
  });

  test("card: a revisão vai para a sessão do card", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Rever", description: "oi" });
    await ctx.board.startCard(card.id);
    const started = await cardWhen(
      ctx.board,
      card.id,
      (c) => c.worktreePath !== null && c.sessionStatus === "idle",
    );
    writeFileSync(join(must(started?.worktreePath, "worktreePath"), "README.md"), "# repo\nnovo\n");
    const review = new ReviewComments({
      db: ctx.store.db,
      changes: new Changes({ db: ctx.store.db, board: ctx.board }),
      manager: ctx.manager,
      board: ctx.board,
    });
    const target = `card:${card.id}`;
    await review.add({
      target,
      path: "README.md",
      side: "new",
      lineStart: 2,
      lineEnd: 2,
      body: "por quê?",
    });
    const result = await review.send(target);
    expect([result.via, result.comments]).toEqual(["card", 1]);
    const sessionId = started?.sessionId ?? "";
    await poll(() => received(ctx, sessionId, "por quê?"));
    expect(received(ctx, sessionId, "por quê?")).toBe(true);
  });

  test("o comentário segue o trecho citado, no lugar mais próximo; sem o trecho fica desatualizado", async () => {
    const { review, target, repo } = await session();
    writeFileSync(join(repo, "c.txt"), "x\ny\nm\nm\nx\ny\n");
    const comment = await review.add({
      target,
      path: "c.txt",
      side: "new",
      lineStart: 5,
      lineEnd: 6,
      body: "aqui",
    });
    writeFileSync(join(repo, "c.txt"), "novo\nx\ny\nm\nm\nx\ny\n");
    expect((await review.list(target)).map((c) => [c.lineStart, c.lineEnd, c.outdated])).toEqual([
      [6, 7, false],
    ]);
    writeFileSync(join(repo, "c.txt"), "novo\nm\nm\n");
    const [outdated] = await review.list(target);
    expect([outdated?.id, outdated?.outdated, outdated?.lineStart]).toEqual([comment.id, true, 6]);
  });

  test("linhas fora do arquivo, caminho fora do repositório e comentário vazio são recusados", async () => {
    const { review, target } = await session();
    const base = { target, side: "new" as const, body: "x" };
    expect(await code(review.add({ ...base, path: "a.txt", lineStart: 4, lineEnd: 9 }))).toBe(
      "bad_request",
    );
    expect(await code(review.add({ ...base, path: "a.txt", lineStart: 3, lineEnd: 2 }))).toBe(
      "bad_request",
    );
    expect(await code(review.add({ ...base, path: "../fora.txt", lineStart: 1, lineEnd: 1 }))).toBe(
      "bad_request",
    );
    expect(await code(review.add({ ...base, path: "nada.txt", lineStart: 1, lineEnd: 1 }))).toBe(
      "bad_request",
    );
    expect(
      await code(review.add({ ...base, body: " ", path: "a.txt", lineStart: 1, lineEnd: 1 })),
    ).toBe("bad_request");
    expect(await code(review.update("nada", "x"))).toBe("not_found");
  });

  test("review.add, review.list, review.update, review.remove e review.send pelo protocolo", async () => {
    const ctx = await session();
    const server = startServer({
      manager: ctx.manager,
      changes: ctx.changes,
      review: ctx.review,
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
    const target = ctx.target;
    const made = await client.data<{ id: string }>("review.add", {
      target,
      path: "a.txt",
      side: "new",
      lineStart: 1,
      lineEnd: 1,
      body: "um?",
    });
    expect(made?.id ?? "").not.toBe("");
    await client.request("review.update", { id: made?.id, body: "um!" });
    const other = await client.data<{ id: string }>("review.add", {
      target,
      path: "b.txt",
      side: "old",
      lineStart: 1,
      lineEnd: 1,
      body: "sai",
    });
    await client.request("review.remove", { id: other?.id });
    const listed = await client.data<{ comments: Array<{ body: string }> }>("review.list", {
      target,
    });
    expect(listed?.comments.map((c) => c.body)).toEqual(["um!"]);
    expect(await client.data("review.send", { target, language: "pt-BR" })).toMatchObject({
      via: "session",
      comments: 1,
      text: expect.stringContaining("Revisão das mudanças:"),
    });
  });

  test("alvo que não resolve mais: os comentários continuam, como histórico desatualizado", async () => {
    const ctx = await session();
    const { review, target } = ctx;
    await review.add({ target, path: "b.txt", side: "old", lineStart: 1, lineEnd: 1, body: "ok?" });
    ctx.store.db.query("UPDATE sessions SET cwd = ?").run(join(ctx.repo, "sumiu"));
    const listed = await review.list(target).catch(() => null);
    expect(listed?.map((c) => [c.body, c.outdated]) ?? "erro").toEqual([["ok?", true]]);
  });
});
