import { type FakeCli, type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { Automations } from "../../src/automations/automations.ts";
import type { BoardOptions } from "../../src/board/board.ts";
import { Issues } from "../../src/issues/issues.ts";
import { cardWhen, git } from "./board-helpers.ts";
import { record } from "./helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git, worktrees and fake CLIs: more than the default 5 s.
/**
 * How long a test lets the scheduler and the fake CLIs work before it calls them hung. Every test
 * here runs real processes, which take as long as the machine lets them: a busy full suite made
 * the 20 s default too short for several, so the limit is a net against a hang, not a budget.
 */
export const NET = 60_000;

export const TOKEN = "automacoes-token-0123456789a";
const WF = "steps:\n  - id: work\n    agent: { prompt: 'faça' }\n";
const GH_REMOTE = "git@github.com:Acme/App.git";
export const UTC = (text: string) => Date.parse(text);

export const ghIssue = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Issue ${n}`,
  body: `corpo ${n}`,
  url: `https://github.com/Acme/App/issues/${n}`,
  author: { login: "ana" },
  labels: [{ name: "auto" }],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "MEMBER",
  ...over,
});
export const GH = (issues: unknown[]): FakeRule[] => [
  { args: ["api", "user"], stdout: "eu\n" },
  { args: ["issue", "list"], stdout: JSON.stringify(issues) },
  ...issues.map((issue) => ({
    args: ["issue", "view", String((issue as { number: number }).number)],
    stdout: JSON.stringify(issue),
  })),
];

/** A PR host that answers what the test sets, without a CLI. */
function prHost() {
  const state: { checks: "failing" | "passing" | null; failed: string[] } = {
    checks: null,
    failed: [],
  };
  const provider = {
    create: async () => "https://github.com/acme/app/pull/3",
    status: async () => ({
      state: "open" as const,
      checks: state.checks,
      ...(state.failed.length > 0 ? { failed: state.failed } : {}),
    }),
    url: async () => null,
    comments: async () => [],
    health: async () => ({ checks: [], conflicts: false }),
    buildLog: async () => "",
  };
  return { state, provider };
}

/** The fake CLIs and the automations setup of a test file, registering what they start into its `cleanups`. */
export function automationsRig(cleanups: Array<() => unknown>) {
  function fake(name: string, rules: FakeRule[]): FakeCli {
    const cli = installFakeCli(name, rules);
    cleanups.push(cli.restore);
    return cli;
  }

  /** A project with a trusted workflow `wf`, and the automations over it with a manual clock. */
  async function setup(
    opts: { github?: boolean; withPr?: boolean; board?: Partial<BoardOptions> } = {},
  ) {
    const pr = prHost();
    let automations: Automations | undefined;
    const ctx = await workflowCard(WF, {
      ...(opts.withPr ? { prProvider: "github" as const } : {}),
      board: {
        prProvider: () => pr.provider,
        prPollIntervalMs: 20,
        ...opts.board,
      },
    });
    if (opts.github) {
      git(ctx.repo, "remote", "add", "origin", GH_REMOTE);
      ctx.board.updateProject(ctx.project.id, {
        issues: { provider: "github", commentOnPr: false },
      });
    }
    const suspended: Array<[string, string]> = [];
    const autoApprove = { suspend: (key: string, reason: string) => suspended.push([key, reason]) };
    const issues = new Issues({ board: ctx.board, autoApprove });
    const time = { now: UTC("2026-10-05T12:00:00Z") };
    const logs: string[] = [];
    const make = (extra: Partial<ConstructorParameters<typeof Automations>[0]> = {}) =>
      new Automations({
        db: ctx.store.db,
        board: ctx.board,
        issues,
        autoApprove,
        clock: () => time.now,
        log: (message) => logs.push(message),
        ...extra,
      });
    automations = make();
    cleanups.push(async () => {
      automations?.stop();
      // A search in flight would reach the CLIs after the test took its fakes away.
      await automations?.idle();
      ctx.board.stop();
    });
    const created = (over: Partial<Parameters<Automations["save"]>[0]> = {}) =>
      (automations as Automations).save({
        projectId: ctx.project.id,
        name: "Auto",
        trigger: { type: "cron", expr: "* * * * *", tz: "UTC" },
        action: { type: "start_workflow", workflow: "nope" },
        ...over,
      });
    /** Saves and turns on. */
    const on = (over: Partial<Parameters<Automations["save"]>[0]> = {}) => {
      const saved = created(over);
      return (automations as Automations).toggle(saved.id, true, true);
    };
    /** A started card with a session that has finished its turn. */
    const sessionCard = async () => {
      const card = ctx.board.createCard(ctx.project.id, {
        title: "Com sessão",
        description: "faça",
      });
      await ctx.board.startCard(card.id);
      const started = await cardWhen(
        ctx.board,
        card.id,
        (c) => c.column === "review" && !!c.sessionId,
      );
      return started as NonNullable<typeof started>;
    };
    const userTexts = (sessionId: string) => {
      const events = record(ctx.manager, sessionId);
      const texts = events.find("message.user").map((e) => e.text);
      events.unsubscribe();
      return texts;
    };
    return {
      ...ctx,
      pr,
      time,
      logs,
      suspended,
      issues,
      make,
      created,
      on,
      sessionCard,
      userTexts,
      get automations() {
        return automations as Automations;
      },
    };
  }

  return { fake, setup };
}

export const code = async (fn: () => unknown) => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
};
export const fired = (a: Automations, id: string) =>
  a.runs(id).filter((r) => r.status === "ok" || r.status === "failed");
