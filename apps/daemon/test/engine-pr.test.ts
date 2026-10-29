import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { cardWhen, git } from "./board-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git, a local remote and the fake gh (a Bun process): more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fakeGh(rules: FakeRule[]): FakeCli {
  const gh = installFakeCli("gh", rules);
  cleanups.push(gh.restore);
  return gh;
}

const PR_URL = "https://github.com/acme/repo/pull/9";
const YAML =
  "steps:\n  - id: work\n    agent: { prompt: '[commit] faça' }\n  - id: pr\n    pr: {}\n";

describe("engine-pr", () => {
  test("etapa pr faz push e abre o PR pelo provedor do projeto; o card vai a Em revisão", async () => {
    const gh = fakeGh([
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: `${PR_URL}\n` },
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
    ]);
    const ctx = await workflowCard(YAML, { prProvider: "github", board: { prPollIntervalMs: 30 } });
    cleanups.push(() => ctx.board.stop());
    await ctx.start();
    const run = await ctx.runWhen((r) => r.status === "completed");
    expect(run?.steps.find((s) => s.stepId === "pr")).toMatchObject({
      type: "pr",
      status: "completed",
      output: PR_URL,
    });
    const card = ctx.board.getCard(ctx.card.id);
    expect(card).toMatchObject({ column: "review", prUrl: PR_URL, prState: "open" });
    expect(git(ctx.remote, "branch", "--list", "fd/*")).toContain(card.branch ?? "?");
    expect(gh.calls().find((args) => args.includes("create"))).toContain(card.branch ?? "?");
    gh.respond([
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "MERGED" }) },
    ]);
    const done = await cardWhen(
      ctx.board,
      ctx.card.id,
      (c) => c.column === "done" && c.worktreePath === null,
    );
    expect(done?.column).toBe("done");
    const work = run?.steps.find((s) => s.stepId === "work");
    expect(ctx.manager.get(work?.sessionId ?? "").status).toBe("ended");
  });

  test("sem provedor de PR, a etapa pr falha a execução", async () => {
    const ctx = await workflowCard(YAML);
    cleanups.push(() => ctx.board.stop());
    await ctx.start();
    const run = await ctx.runWhen((r) => r.status === "failed");
    expect(run?.statusReason).toBe("etapa pr falhou: projeto sem provedor de PR");
    expect(run?.steps.map((s) => `${s.stepId} ${s.status}`)).toEqual([
      "work completed",
      "pr failed",
    ]);
  });
});
