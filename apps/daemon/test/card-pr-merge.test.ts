import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import type { PrProvider, PrStatus } from "../src/board/pr.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #1196: a card's open PR is merged from the card. `gh pr merge` is the only thing that
 * merges; nothing merges without the confirm; a refusal says why. The tests use the fake gh.
 */
const PR_URL = "https://github.com/acme/repo/pull/9";
const DIAGNOSE = "mergeStateStatus,reviewDecision,statusCheckRollup";
const OPEN = {
  args: ["view", "state,statusCheckRollup"],
  stdout: JSON.stringify({ state: "OPEN" }),
};
const MERGED = {
  args: ["view", "state,statusCheckRollup"],
  stdout: JSON.stringify({ state: "MERGED" }),
};

function fakeGh(rules: FakeRule[]) {
  const gh = installFakeCli("gh", rules);
  cleanups.push(gh.restore);
  return gh;
}

/** A board with a GitHub project and a card in review whose PR is open (not started: no worktree). */
async function setup(
  options: { provider?: "github" | "azure-devops"; pr?: "open" | "merged" | null } = {},
) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: options.provider ?? "github",
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "Sum numbers", description: "add them" });
  const pr = options.pr === undefined ? "open" : options.pr;
  if (pr !== null) {
    ctx.store.db
      .query("UPDATE cards SET pr_url = ?, pr_state = ?, board_column = ? WHERE id = ?")
      .run(PR_URL, pr, pr === "open" ? "review" : "done", card.id);
  }
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

describe("card-pr-merge: the card merges its open PR, after a confirm (#1196)", () => {
  test("a squash and a merge commit call gh pr merge with the PR's URL and that method, then the card is Done", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }, MERGED]);
    const squashed = await setup();
    const done = await squashed.board.mergePr(squashed.cardId, "squash", true);
    const merged = await setup();
    await merged.board.mergePr(merged.cardId, "merge", true);
    const calls = gh.calls().filter((args) => args.includes("merge"));
    expect([
      calls,
      done.column,
      done.prState,
      squashed.board.getCard(squashed.cardId).column,
    ]).toEqual([
      [
        ["pr", "merge", PR_URL, "--squash"],
        ["pr", "merge", PR_URL, "--merge"],
      ],
      "done",
      "merged",
      "done",
    ]);
  });

  test("gh is never asked to skip the rules: no admin, no auto, no branch delete, no message", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }, MERGED]);
    const ctx = await setup();
    await ctx.board.mergePr(ctx.cardId, "squash", true);
    const flags = gh
      .calls()
      .filter((args) => args.includes("merge"))
      .flat()
      .filter((arg) => arg.startsWith("--"));
    expect(flags).toEqual(["--squash"]);
  });

  test("without the confirm nothing is asked of gh", async () => {
    const gh = fakeGh([OPEN, { args: ["pr", "merge"] }]);
    const ctx = await setup();
    const refused = await reason(ctx.board.mergePr(ctx.cardId, "squash", false));
    expect([refused, gh.calls().length, ctx.board.getCard(ctx.cardId).prState]).toEqual([
      "merge_confirm",
      0,
      "open",
    ]);
  });

  test("a card with no PR, a PR that is not open, and a project with no provider are refused first", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }]);
    const none = await setup({ pr: null });
    const closed = await setup({ pr: "merged" });
    const bare = await setup({ provider: "azure-devops" });
    const noProvider = await setup();
    noProvider.store.db.query("UPDATE projects SET pr_provider = 'none'").run();
    expect([
      await reason(none.board.mergePr(none.cardId, "merge", true)),
      await reason(closed.board.mergePr(closed.cardId, "merge", true)),
      await reason(bare.board.mergePr(bare.cardId, "merge", true)),
      await reason(noProvider.board.mergePr(noProvider.cardId, "merge", true)),
      gh.calls().length,
    ]).toEqual([
      "card_no_pr",
      "card_pr_not_open",
      "card_pr_merge_unsupported",
      "project_no_pr_provider",
      0,
    ]);
  });

  test("a refused merge says why: review required, checks, a conflict, or gh's own words; the card stays in review", async () => {
    const refuse = { args: ["pr", "merge"], code: 1, stderr: "X Pull request is not mergeable" };
    const diagnosis = (state: object): FakeRule => ({
      args: ["view", DIAGNOSE],
      stdout: JSON.stringify(state),
    });
    const gh = fakeGh([refuse]);
    const ctx = await setup();
    const why = async (state: object | null) => {
      gh.respond(state === null ? [refuse] : [refuse, diagnosis(state)]);
      return reason(ctx.board.mergePr(ctx.cardId, "squash", true));
    };
    expect([
      await why({
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
        statusCheckRollup: [],
      }),
      await why({
        mergeStateStatus: "BLOCKED",
        reviewDecision: "APPROVED",
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE", name: "ci" }],
      }),
      await why({
        mergeStateStatus: "BLOCKED",
        reviewDecision: "APPROVED",
        statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "", name: "ci" }],
      }),
      await why({ mergeStateStatus: "DIRTY", reviewDecision: "APPROVED", statusCheckRollup: [] }),
      await why(null),
    ]).toEqual([
      "card_pr_review_required",
      "card_pr_checks_failing",
      "card_pr_checks_failing",
      "card_pr_conflict",
      "card_pr_merge_failed",
    ]);
    expect(ctx.board.getCard(ctx.cardId)).toMatchObject({ column: "review", prState: "open" });
  });

  test("the refusal carries the PR's address so the card can link to it", async () => {
    fakeGh([{ args: ["pr", "merge"], code: 1, stderr: "boom" }]);
    const ctx = await setup();
    const error = await ctx.board.mergePr(ctx.cardId, "merge", true).then(
      () => null,
      (caught: { params?: Record<string, string> }) => caught,
    );
    expect(error?.params?.url).toBe(PR_URL);
  });

  test("the PR's address is rebuilt before gh gets it, and a stored address that is no GitHub PR is refused", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }, MERGED]);
    const odd = await setup();
    odd.store.db
      .query("UPDATE cards SET pr_url = ? WHERE id = ?")
      .run(`${PR_URL}?next=--admin#x`, odd.cardId);
    const bad = await setup();
    bad.store.db.query("UPDATE cards SET pr_url = ? WHERE id = ?").run("--admin", bad.cardId);
    const refused = await reason(bad.board.mergePr(bad.cardId, "merge", true));
    await odd.board.mergePr(odd.cardId, "merge", true);
    expect([refused, gh.calls().filter((args) => args.includes("merge"))]).toEqual([
      "pr_url_invalid",
      [["pr", "merge", PR_URL, "--merge"]],
    ]);
  });

  test("a PR merged by gh is a success even when the read that follows fails: a notice, then the next round moves the card", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }]);
    const ctx = await setup();
    gh.respond([{ args: ["pr", "merge"] }, { args: ["view", "state,statusCheckRollup"], code: 1 }]);
    const card = await ctx.board.mergePr(ctx.cardId, "merge", true);
    const after = [card.notice !== null, card.prState];
    gh.respond([MERGED]);
    await ctx.board.pollPrs();
    const next = ctx.board.getCard(ctx.cardId);
    expect([after, next.column, next.prState]).toEqual([[true, "open"], "done", "merged"]);
  });

  test("a refusal's message is fixed; gh's own words travel as the detail of the unknown one only, without tokens", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"], code: 1, stderr: "x" }]);
    const ctx = await setup();
    const refusal = async (stderr: string, diagnosis: FakeRule | null) => {
      const refuse = { args: ["pr", "merge"], code: 1, stderr };
      gh.respond(diagnosis === null ? [refuse] : [refuse, diagnosis]);
      return ctx.board.mergePr(ctx.cardId, "merge", true).then(
        () => ({ message: "", params: {} as Record<string, string> }),
        (caught: { message: string; params?: Record<string, string> }) => ({
          message: caught.message,
          params: caught.params ?? {},
        }),
      );
    };
    const known = await refusal("SECRET-WORDS", {
      args: ["view", DIAGNOSE],
      stdout: JSON.stringify({ mergeStateStatus: "DIRTY", statusCheckRollup: [] }),
    });
    const unknown = await refusal(
      "denied for ghp_abcDEF123456 and Bearer abc.def-123 and github_pat_11AAA_xyz via https://me:pw@github.com",
      null,
    );
    expect([
      known.message.includes("SECRET-WORDS"),
      known.params.detail,
      unknown.message.includes("denied"),
      unknown.params.detail,
    ]).toEqual([
      false,
      undefined,
      false,
      "denied for [token] and [token] and [token] via https://[token]@github.com",
    ]);
  });

  test("a poll and a merge asking about the same card at once ask the provider once", async () => {
    const status = Promise.withResolvers<PrStatus>();
    let asked = 0;
    const provider: PrProvider = {
      create: async () => PR_URL,
      status: () => {
        asked++;
        return status.promise;
      },
      url: async () => null,
      comments: async () => [],
      health: async () => ({ checks: [], conflicts: false }),
      buildLog: async () => "",
      merge: async () => {},
    };
    const ctx = newBoard({ prProvider: () => provider });
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({
      path: ctx.repo,
      prProvider: "github",
      promptTemplate: "",
    });
    const card = ctx.board.createCard(project.id, { title: "Sum", description: "add" });
    ctx.store.db
      .query("UPDATE cards SET pr_url = ?, pr_state = 'open', board_column = 'review' WHERE id = ?")
      .run(PR_URL, card.id);
    const round = ctx.board.pollPrs();
    const merging = ctx.board.mergePr(card.id, "merge", true);
    // Only microtasks and a spawn-free stand-in run here: both have reached the provider by now.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const whileAsking = asked;
    status.resolve({ state: "merged", checks: null });
    await Promise.all([round, merging]);
    expect([whileAsking, ctx.board.getCard(card.id).column]).toEqual([1, "done"]);
  });

  test("a poll that was already asking before the merge landed does not decide the card: the merge reads again", async () => {
    const first = Promise.withResolvers<PrStatus>();
    let asked = 0;
    const provider: PrProvider = {
      create: async () => PR_URL,
      status: () => {
        asked++;
        return asked === 1 ? first.promise : Promise.resolve({ state: "merged", checks: null });
      },
      url: async () => null,
      comments: async () => [],
      health: async () => ({ checks: [], conflicts: false }),
      buildLog: async () => "",
      merge: async () => {},
    };
    const ctx = newBoard({ prProvider: () => provider });
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({
      path: ctx.repo,
      prProvider: "github",
      promptTemplate: "",
    });
    const card = ctx.board.createCard(project.id, { title: "Sum", description: "add" });
    ctx.store.db
      .query("UPDATE cards SET pr_url = ?, pr_state = 'open', board_column = 'review' WHERE id = ?")
      .run(PR_URL, card.id);
    const round = ctx.board.pollPrs();
    const merging = ctx.board.mergePr(card.id, "merge", true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // The read that began before the merge answers: still open.
    first.resolve({ state: "open", checks: null });
    const result = await merging;
    await round;
    expect([result.column, result.prState]).toEqual(["done", "merged"]);
  });

  test("the server merges over a near connection once confirmed, and refuses a far one", async () => {
    const gh = fakeGh([{ args: ["pr", "merge"] }, MERGED]);
    const ctx = await setup();
    const token = "card-pr-merge-token-0123456789";
    const base = {
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [ctx.root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const near = startServer(base);
    const far = startServer({ ...base, peerOf: () => "8.8.8.8" });
    cleanups.push(
      () => near.stop(),
      () => far.stop(),
    );
    const clients = [new FrameClient(near.url), new FrameClient(far.url)];
    cleanups.push(() => {
      for (const client of clients) client.close();
    });
    for (const client of clients) await client.request("hello", { token, client: "t" });
    const [nearClient, farClient] = clients as [FrameClient, FrameClient];
    const merge = async (client: FrameClient, payload: Record<string, unknown>) => {
      const ack = await client.request("card.pr.merge", { cardId: ctx.cardId, ...payload });
      const error = ack.error as { reason?: string } | undefined;
      return ack.ok === true ? "ok" : (error?.reason ?? "refused");
    };
    expect([
      await merge(farClient, { method: "squash", confirm: true }),
      await merge(nearClient, { method: "squash" }),
      gh.calls().filter((args) => args.includes("merge")).length,
      await merge(nearClient, { method: "squash", confirm: true }),
      gh.calls().filter((args) => args.includes("merge")).length,
    ]).toEqual(["transport_refused", "merge_confirm", 0, "ok", 1]);
  });
});
