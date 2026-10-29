import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import type { PrProviderKind } from "../src/board/types.ts";
import { startServer } from "../src/server.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real git and fake CLIs (each one a Bun process): more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "pr-comments-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

const GH_URL = "https://github.com/acme/repo/pull/7";
const AZ_URL = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/12";

const GH_RULES: FakeRule[] = [
  { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
  {
    args: ["api", "repos/acme/repo/pulls/7/comments"],
    stdout: JSON.stringify([
      { id: 101, path: "src/a.ts", line: 10, user: { login: "alice" }, body: "corrija isto" },
      {
        id: 102,
        path: "src/b.ts",
        line: null,
        original_line: 4,
        user: { login: "carol" },
        body: "resolvido já",
      },
    ]),
  },
  {
    args: ["view", "reviews"],
    stdout: JSON.stringify({
      reviews: [
        {
          id: "R_1",
          author: { login: "bob" },
          body: "parece bom, mas veja os testes",
          state: "COMMENTED",
        },
        { id: "R_2", author: { login: "bob" }, body: "", state: "APPROVED" },
      ],
    }),
  },
  {
    args: ["api", "graphql"],
    stdout: JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { isResolved: false, comments: { nodes: [{ databaseId: 101 }] } },
                { isResolved: true, comments: { nodes: [{ databaseId: 102 }] } },
              ],
            },
          },
        },
      },
    }),
  },
];

const AZ_RULES: FakeRule[] = [
  { args: ["repos", "pr", "show"], stdout: JSON.stringify({ status: "active" }) },
  { args: ["repos", "pr", "policy", "list"], stdout: "[]" },
  {
    args: ["devops", "invoke", "pullRequestThreads"],
    stdout: JSON.stringify({
      value: [
        {
          id: 5,
          status: "active",
          threadContext: { filePath: "/src/a.ts", rightFileStart: { line: 3 } },
          comments: [
            { id: 1, author: { displayName: "Ana" }, content: "nome ruim", commentType: "text" },
            { id: 2, author: { displayName: "Bia" }, content: "concordo", commentType: "text" },
          ],
        },
        {
          id: 6,
          status: "fixed",
          threadContext: null,
          comments: [
            { id: 1, author: { displayName: "Caio" }, content: "geral", commentType: "text" },
          ],
        },
        {
          id: 7,
          status: "active",
          threadContext: null,
          comments: [
            { id: 1, author: { displayName: "Sistema" }, content: "votou", commentType: "system" },
          ],
        },
        { id: 8, status: "active", isDeleted: true, threadContext: null, comments: [] },
      ],
    }),
  },
];

/** A card started and idle whose PR is open at `url`. */
async function cardWithPr(provider: PrProviderKind, url: string) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: provider,
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "Com PR", description: "oi" });
  await ctx.board.startCard(card.id);
  const started = await cardWhen(ctx.board, card.id, (c) => c.sessionStatus === "idle");
  ctx.store.db
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open' WHERE id = ?")
    .run(url, card.id);
  return { ...ctx, cardId: card.id, sessionId: started?.sessionId ?? "" };
}

/** No call of the fake posts anything: no REST method, no mutation, no comment or review command. */
function nothingPosted(cli: FakeCli): boolean {
  return cli.calls().every((args) => {
    const text = args.join(" ");
    return (
      !args.includes("-X") &&
      !args.includes("--method") &&
      !args.includes("--http-method") &&
      !/mutation/.test(text) &&
      !/\bpr (comment|review)\b/.test(text) &&
      !/\bthread (create|update)\b/.test(text)
    );
  });
}

const received = (
  ctx: { store: { db: import("bun:sqlite").Database } },
  id: string,
  text: string,
) =>
  ctx.store.db
    .query("SELECT 1 FROM events WHERE session_id = ? AND payload LIKE ?")
    .get(id, `%${text}%`) !== null;

describe("pr-comentarios", () => {
  test("GitHub: comentários de revisão com arquivo, linha, autor e resolvido, mais o resumo das revisões", async () => {
    const gh = fake("gh", GH_RULES);
    const ctx = await cardWithPr("github", GH_URL);
    await ctx.board.pollPrs();
    expect(await ctx.board.prComments(ctx.cardId)).toEqual([
      {
        id: "101",
        path: "src/a.ts",
        line: 10,
        author: "alice",
        body: "corrija isto",
        resolved: false,
        kind: "inline",
      },
      {
        id: "102",
        path: "src/b.ts",
        line: 4,
        author: "carol",
        body: "resolvido já",
        resolved: true,
        kind: "inline",
      },
      {
        id: "review-R_1",
        path: null,
        line: null,
        author: "bob",
        body: "parece bom, mas veja os testes",
        resolved: false,
        kind: "review",
      },
    ]);
    expect(nothingPosted(gh)).toBe(true);
  });

  test("Azure DevOps: threads pelo az devops invoke, resolvidas pelo status, sem as do sistema nem as apagadas", async () => {
    const az = fake("az", AZ_RULES);
    const ctx = await cardWithPr("azure-devops", AZ_URL);
    await ctx.board.pollPrs();
    expect(await ctx.board.prComments(ctx.cardId)).toEqual([
      {
        id: "5/1",
        path: "src/a.ts",
        line: 3,
        author: "Ana",
        body: "nome ruim",
        resolved: false,
        kind: "inline",
      },
      {
        id: "5/2",
        path: "src/a.ts",
        line: 3,
        author: "Bia",
        body: "concordo",
        resolved: false,
        kind: "inline",
      },
      {
        id: "6/1",
        path: null,
        line: null,
        author: "Caio",
        body: "geral",
        resolved: true,
        kind: "review",
      },
    ]);
    const invoke = az.calls().find((args) => args.includes("invoke")) ?? [];
    expect(invoke).toEqual(
      expect.arrayContaining([
        "--area",
        "git",
        "--resource",
        "pullRequestThreads",
        "project=proj",
        "repositoryId=repo",
        "pullRequestId=12",
        "--org",
        "https://dev.azure.com/acme",
      ]),
    );
    expect(nothingPosted(az)).toBe(true);
  });

  test("enviar ao agente manda os escolhidos para a sessão do card, sem postar nada", async () => {
    const gh = fake("gh", GH_RULES);
    const ctx = await cardWithPr("github", GH_URL);
    expect(await ctx.board.sendPrComments(ctx.cardId, ["101", "review-R_1"])).toEqual({ sent: 2 });
    const text = [
      "Comentários do PR:",
      "1. `src/a.ts` linha 10 (alice):",
      "   corrija isto",
      "2. revisão de bob:",
      "   parece bom, mas veja os testes",
    ].join("\n");
    await poll(() => received(ctx, ctx.sessionId, "Comentários do PR:"));
    expect(received(ctx, ctx.sessionId, JSON.stringify(text).slice(1, -1))).toBe(true);
    expect(nothingPosted(gh)).toBe(true);
  });

  test("busca que falha guarda os últimos comentários e não mexe no aviso do card; card sem PR é recusado", async () => {
    const gh = fake("gh", GH_RULES);
    const ctx = await cardWithPr("github", GH_URL);
    await ctx.board.pollPrs();
    gh.respond([
      GH_RULES[0] as FakeRule,
      { args: ["api"], code: 1 },
      { args: ["view", "reviews"], code: 1 },
    ]);
    await ctx.board.pollPrs();
    expect((await ctx.board.prComments(ctx.cardId)).map((c) => c.id)).toEqual([
      "101",
      "102",
      "review-R_1",
    ]);
    expect(ctx.board.getCard(ctx.cardId).notice).toBeNull();
    ctx.store.db.query("UPDATE cards SET pr_url = NULL WHERE id = ?").run(ctx.cardId);
    const refused = await ctx.board.prComments(ctx.cardId).then(
      () => "ok",
      (error: { code?: string }) => error.code,
    );
    expect(refused).toBe("invalid_state");
  });

  test("pr.comments e pr.comments.send pelo protocolo", async () => {
    fake("gh", GH_RULES);
    const ctx = await cardWithPr("github", GH_URL);
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
    const got = await client.data<{ comments: Array<{ id: string }> }>("pr.comments", {
      cardId: ctx.cardId,
    });
    expect(got?.comments.map((c) => c.id)).toEqual(["101", "102", "review-R_1"]);
    expect(await client.data("pr.comments.send", { cardId: ctx.cardId, ids: ["102"] })).toEqual({
      sent: 1,
    });
    expect(
      await client.request("pr.comments.send", { cardId: ctx.cardId, ids: ["nada"] }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });
});
