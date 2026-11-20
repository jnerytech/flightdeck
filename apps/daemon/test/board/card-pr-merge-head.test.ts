import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Command } from "@flightdeck/protocol";
import { type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { newBoard } from "../support/board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3453: a merge that carries the pull request and the head commit the person saw is bound to
 * them. The daemon reads the head again, refuses when it moved, and asks `gh` to merge only that commit.
 */
const PR_URL = "https://github.com/acme/repo/pull/9";
const OTHER_URL = "https://github.com/acme/repo/pull/10";
const SEEN = "a".repeat(40);
const MOVED = "b".repeat(40);
const MERGED = {
  args: ["view", "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt"],
  stdout: JSON.stringify({ state: "MERGED" }),
};
const headIs = (sha: string): FakeRule => ({
  args: ["view", "headRefOid"],
  stdout: JSON.stringify({ headRefOid: sha }),
});

function fakeGh(rules: FakeRule[]) {
  const gh = installFakeCli("gh", rules);
  cleanups.push(gh.restore);
  return gh;
}

/** A board with a GitHub project and a card in review whose PR is open. */
async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: "github",
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "Sum numbers", description: "add them" });
  ctx.store.db
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open', board_column = 'review' WHERE id = ?")
    .run(PR_URL, card.id);
  return { ...ctx, cardId: card.id };
}

async function reason(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

const mergeCalls = (gh: { calls(): string[][] }) =>
  gh.calls().filter((args) => args.includes("merge"));

describe("card-pr-merge-head: a merge bound to the head commit the person saw (#3453)", () => {
  test("the card's PR address and its head commit are read live from the provider", async () => {
    fakeGh([headIs(SEEN)]);
    const ctx = await setup();
    expect(await ctx.board.prHead(ctx.cardId)).toEqual({ prUrl: PR_URL, headSha: SEEN });
  });

  test("a merge that names the head it saw asks gh to merge only that commit", async () => {
    const gh = fakeGh([headIs(SEEN), { args: ["pr", "merge"] }, MERGED]);
    const ctx = await setup();
    await ctx.board.mergePr(ctx.cardId, "squash", true, { prUrl: PR_URL, headSha: SEEN });
    expect(mergeCalls(gh)).toEqual([
      ["pr", "merge", PR_URL, "--squash", "--match-head-commit", SEEN],
    ]);
  });

  test("a head that moved since the person looked is refused as stale and nothing is merged", async () => {
    const gh = fakeGh([headIs(MOVED), { args: ["pr", "merge"] }]);
    const ctx = await setup();
    const refused = await reason(
      ctx.board.mergePr(ctx.cardId, "squash", true, { prUrl: PR_URL, headSha: SEEN }),
    );
    expect([refused, mergeCalls(gh), ctx.board.getCard(ctx.cardId).prState]).toEqual([
      "card_pr_stale",
      [],
      "open",
    ]);
  });

  test("another pull request's address is refused as stale before gh is asked anything", async () => {
    const gh = fakeGh([headIs(SEEN), { args: ["pr", "merge"] }]);
    const ctx = await setup();
    const refused = await reason(
      ctx.board.mergePr(ctx.cardId, "squash", true, { prUrl: OTHER_URL, headSha: SEEN }),
    );
    expect([refused, gh.calls().length]).toEqual(["card_pr_stale", 0]);
  });

  test("a merge that names nothing is as before: no head is read and no commit is matched", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }, MERGED]);
    const ctx = await setup();
    await ctx.board.mergePr(ctx.cardId, "squash", true);
    expect(mergeCalls(gh)).toEqual([["pr", "merge", PR_URL, "--squash"]]);
  });

  test("the command takes the address and the head together, and a head that is not a commit hash is refused", () => {
    const accepts = (payload: Record<string, unknown>) =>
      Command.safeParse({
        id: "1",
        type: "card.pr.merge",
        payload: { cardId: "c", method: "squash", confirm: true, ...payload },
      }).success;
    expect([
      accepts({ prUrl: PR_URL, headSha: SEEN }),
      accepts({ prUrl: PR_URL, headSha: "c".repeat(64) }),
      accepts({}),
      accepts({ prUrl: PR_URL }),
      accepts({ headSha: SEEN }),
      accepts({ prUrl: PR_URL, headSha: "--delete-branch" }),
      accepts({ prUrl: PR_URL, headSha: "a".repeat(39) }),
    ]).toEqual([true, true, true, false, false, false, false]);
  });
});
