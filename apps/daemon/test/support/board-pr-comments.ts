import { type FakeCli, type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import type { PrProviderKind } from "../../src/board/types.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

export const GH_URL = "https://github.com/acme/repo/pull/7";

export const GH_RULES: FakeRule[] = [
  {
    args: ["view", "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt"],
    stdout: JSON.stringify({ state: "OPEN" }),
  },
  // `--paginate --slurp`: an array of pages (REST pages hold 30 by default, 100 at most).
  {
    args: ["api", "--paginate", "--slurp", "repos/acme/repo/pulls/7/comments?per_page=100"],
    stdout: JSON.stringify([
      [
        {
          id: 101,
          path: "src/a.ts",
          line: 10,
          user: { login: "alice" },
          author_association: "MEMBER",
          body: "corrija isto",
        },
      ],
      [
        {
          id: 102,
          path: "src/b.ts",
          line: null,
          original_line: 4,
          user: { login: "carol" },
          author_association: "NONE",
          body: "resolvido já",
        },
      ],
    ]),
  },
  // Without pagination only the first page would come: the second comment would be lost.
  {
    args: ["api", "repos/acme/repo/pulls/7/comments"],
    stdout: JSON.stringify([
      { id: 101, path: "src/a.ts", line: 10, user: { login: "alice" }, body: "corrija isto" },
    ]),
  },
  {
    args: ["view", "reviews"],
    stdout: JSON.stringify({
      reviews: [
        {
          id: "R_1",
          author: { login: "bob" },
          authorAssociation: "OWNER",
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

/** A card started and idle whose PR is open at `url`. */
export async function cardWithPr(provider: PrProviderKind, url: string) {
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
