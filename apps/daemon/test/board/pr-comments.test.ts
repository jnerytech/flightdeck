import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FakeCli, FakeRule } from "../../../../scripts/test/fake-cli.ts";
import { cardWithPr, fake, GH_RULES, GH_URL, runCleanups } from "../support/board-pr-comments.ts";
import { poll } from "../support/helpers.ts";

// Real git and fake CLIs (each one a Bun process): more than the default 5 s.
setDefaultTimeout(30_000);

afterEach(runCleanups);

const AZ_URL = "https://dev.azure.com/acme/Meu%20Projeto/_git/repo/pullrequest/12";

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
            {
              id: 1,
              author: { displayName: "Ana", uniqueName: "ana@acme.com", id: "id-ana" },
              content: "nome ruim",
              commentType: "text",
            },
            {
              id: 2,
              author: { displayName: "Bia", id: "id-bia" },
              content: "concordo",
              commentType: "text",
            },
          ],
        },
        {
          id: 6,
          status: "fixed",
          threadContext: null,
          comments: [
            {
              id: 1,
              author: { displayName: "Caio", uniqueName: "caio@acme.com", id: "id-caio" },
              content: "geral",
              commentType: "text",
            },
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
        authorAssociation: "MEMBER",
        authorIdentity: null,
        body: "corrija isto",
        resolved: false,
        kind: "inline",
      },
      {
        id: "102",
        path: "src/b.ts",
        line: 4,
        author: "carol",
        authorAssociation: "NONE",
        authorIdentity: null,
        body: "resolvido já",
        resolved: true,
        kind: "inline",
      },
      {
        id: "review-R_1",
        path: null,
        line: null,
        author: "bob",
        authorAssociation: "OWNER",
        authorIdentity: null,
        body: "parece bom, mas veja os testes",
        resolved: false,
        kind: "review",
      },
    ]);
    expect(nothingPosted(gh)).toBe(true);
    // Every page of the comments, 100 at a time, with the GET that `gh api` makes by default.
    const rest = gh.calls().find((args) => args.some((a) => a.includes("/pulls/7/comments"))) ?? [];
    expect(rest).toEqual([
      "api",
      "--paginate",
      "--slurp",
      "repos/acme/repo/pulls/7/comments?per_page=100",
    ]);
    // The threads' query: ours from stdin, the names as they are (-f), the number typed (-F).
    // Checked against the real gh: a stray argument there is "accepts 1 arg(s), received 2".
    const graphql = gh.calls().find((args) => args.includes("graphql")) ?? [];
    expect(graphql).toEqual([
      "api",
      "graphql",
      "-F",
      "query=@-",
      "-f",
      "owner=acme",
      "-f",
      "name=repo",
      "-F",
      "number=7",
    ]);
  });

  test("Azure DevOps: threads pelo az devops invoke, resolvidas pelo status, sem as do sistema nem as apagadas", async () => {
    const az = fake("az", AZ_RULES);
    const ctx = await cardWithPr("azure-devops", AZ_URL);
    await ctx.board.pollPrs();
    // A failure of the fetch shows up as text, so it fails the comparison and not the test run.
    const comments = await ctx.board
      .prComments(ctx.cardId)
      .catch((error: Error) => `erro: ${error.message}`);
    expect(comments).toEqual([
      {
        id: "5/1",
        path: "src/a.ts",
        line: 3,
        author: "Ana",
        authorAssociation: null,
        authorIdentity: "ana@acme.com",
        body: "nome ruim",
        resolved: false,
        kind: "inline",
      },
      {
        id: "5/2",
        path: "src/a.ts",
        line: 3,
        author: "Bia",
        authorAssociation: null,
        authorIdentity: "id-bia",
        body: "concordo",
        resolved: false,
        kind: "inline",
      },
      {
        id: "6/1",
        path: null,
        line: null,
        author: "Caio",
        authorAssociation: null,
        authorIdentity: "caio@acme.com",
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
        "project=Meu Projeto",
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

  test("segurança, GitHub: texto de terceiros com @ chega literal ao agente e nada de fora vai por -F ao gh", async () => {
    // Third parties wrote these: `gh api -F campo=@arquivo` would read a local file.
    const rules = GH_RULES.map((rule) =>
      rule.args.includes("--paginate")
        ? {
            ...rule,
            stdout: JSON.stringify([
              [
                { id: 201, path: "a.ts", line: 1, user: { login: "m" }, body: "@/etc/passwd" },
                { id: 202, path: "a.ts", line: 2, user: { login: "m" }, body: "campo=@arquivo" },
              ],
            ]),
          }
        : rule,
    );
    const gh = fake("gh", rules);
    // The URL itself is also kept out of the arguments as it is: only owner, repo and number.
    const ctx = await cardWithPr("github", `@/etc/passwd#${GH_URL.replace("https://", "")}`);
    const comments = await ctx.board.prComments(ctx.cardId);
    expect(comments.map((c) => c.body)).toEqual([
      "@/etc/passwd",
      "campo=@arquivo",
      "parece bom, mas veja os testes",
    ]);
    expect(await ctx.board.sendPrComments(ctx.cardId, ["201", "202"])).toEqual({ sent: 2 });
    await poll(() => received(ctx, ctx.sessionId, "campo=@arquivo"));
    expect(received(ctx, ctx.sessionId, "   @/etc/passwd")).toBe(true);
    expect(received(ctx, ctx.sessionId, "   campo=@arquivo")).toBe(true);
    // -F (typed fields, which read files for @) only for our fixed query and the PR number;
    // texts and names go with -f, which sends them as they are.
    const typed = gh
      .calls()
      .flatMap((args) => args.flatMap((a, i) => (args[i - 1] === "-F" ? [a] : [])));
    expect(typed.sort()).toEqual(["number=7", "query=@-"]);
    const risky = gh
      .calls()
      .flat()
      .filter((a) => /(^|=)@/.test(a));
    expect(risky).toEqual(["query=@-"]);
  });

  test("segurança, Azure: projeto ou repositório da URL que começa com @ (ou tem quebra de linha) é recusado antes do az", async () => {
    const az = fake("az", AZ_RULES);
    const base = "https://dev.azure.com/acme";
    for (const url of [
      `${base}/%40leia-isto/_git/repo/pullrequest/12`,
      `${base}/proj/_git/%40repo/pullrequest/12`,
      `${base}/proj%0Aoutro/_git/repo/pullrequest/12`,
    ]) {
      const ctx = await cardWithPr("azure-devops", url);
      const refused = await ctx.board.prComments(ctx.cardId).then(
        () => "aceito",
        (error: { code?: string }) => error.code,
      );
      expect(refused).toBe("invalid_state");
    }
    expect(
      az
        .calls()
        .flat()
        .filter((a) => /(^|=)@/.test(a)),
    ).toEqual([]);
    expect(az.calls().some((args) => args.includes("invoke"))).toBe(false);
  });
});
