import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli, type PrProvider } from "../src/board/pr.ts";
import { PrWatcher, type WatchTrigger } from "../src/watch/watch.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

// Real git and fake CLIs (each one a Bun process): more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fakeAz(rules: FakeRule[]): FakeCli {
  const cli = installFakeCli("az", rules);
  cleanups.push(cli.restore);
  return cli;
}

const AZ_WEB = "https://dev.azure.com/acme/proj/_git/repo";
const PR = `${AZ_WEB}/pullrequest/9`;

const show = (mergeStatus: string): FakeRule => ({
  args: ["repos", "pr", "show"],
  stdout: JSON.stringify({
    status: "active",
    mergeStatus,
    repository: { project: { id: "proj-guid", name: "proj" } },
  }),
});

const evaluation = (status: string, name: string, buildId?: number) => ({
  evaluationId: `e-${name}`,
  status,
  configuration: {
    type: { displayName: buildId === undefined ? "Minimum number of reviewers" : "Build" },
    settings: { displayName: name },
  },
  context: buildId === undefined ? {} : { buildId },
});

const evaluations = (...items: unknown[]): FakeRule => ({
  args: ["evaluations"],
  stdout: JSON.stringify({ count: items.length, value: items }),
});

const NO_COMMENTS: FakeRule = { args: ["pullRequestThreads"], stdout: '{"value":[]}' };

describe("vigiar-ado: builds, policies and conflicts through az", () => {
  test("health reads the policy evaluations of the PR and its merge status", async () => {
    const az = fakeAz([
      show("conflicts"),
      evaluations(
        evaluation("rejected", "CI", 88),
        evaluation("running", "Lint", 89),
        evaluation("approved", "Unit tests", 90),
        evaluation("rejected", "Required reviewers"),
        evaluation("notApplicable", "Work item linking"),
      ),
    ]);
    const health = await new AzureDevOpsCli().health({ cwd: tempDir(), url: PR });
    expect(health).toEqual({
      checks: [
        { name: "CI", state: "failing", kind: "build", buildId: "88" },
        { name: "Lint", state: "pending", kind: "build", buildId: "89" },
        { name: "Unit tests", state: "passing", kind: "build", buildId: "90" },
        { name: "Required reviewers", state: "failing", kind: "policy", buildId: null },
        { name: "Work item linking", state: "passing", kind: "policy", buildId: null },
      ],
      conflicts: true,
    });
    // The evaluations are asked of the preview route, by the PR's artifact id.
    const call = az.calls().find((args) => args.includes("evaluations")) ?? [];
    expect(call).toEqual([
      "devops",
      "invoke",
      "--area",
      "policy",
      "--resource",
      "evaluations",
      "--route-parameters",
      "project=proj",
      "--query-parameters",
      "artifactId=vstfs:///CodeReview/CodeReviewId/proj-guid/9",
      "--org",
      "https://dev.azure.com/acme",
      "--api-version",
      "7.1-preview.1",
      "--output",
      "json",
    ]);
  });

  test("a PR that merges cleanly has no conflict, and a queued evaluation is pending", async () => {
    const unnamed = {
      ...evaluation("approved", "x"),
      configuration: { type: { displayName: "Build" } },
    };
    fakeAz([show("succeeded"), evaluations(evaluation("queued", "CI", 5), unnamed)]);
    const health = await new AzureDevOpsCli().health({ cwd: tempDir(), url: PR });
    expect(health.conflicts).toBe(false);
    expect(health.checks.map((c) => c.state)).toEqual(["pending", "passing"]);
    // A policy with no name of its own goes by its type's.
    expect(health.checks.map((c) => c.name)).toEqual(["CI", "Build"]);
  });

  test("buildLog gives the end of the log of each task that failed, cut at 16 KB", async () => {
    const big = `${"x".repeat(20_000)}\nERRO: 3 testes falharam`;
    const az = fakeAz([
      {
        args: ["timeline"],
        stdout: JSON.stringify({
          records: [
            { type: "Stage", name: "Build", result: "failed", log: null },
            { type: "Task", name: "Restore", result: "succeeded", log: { id: 3 } },
            { type: "Task", name: "Run tests", result: "failed", log: { id: 12 } },
            { type: "Task", name: "Lint", result: "failed", log: { id: 14 } },
          ],
        }),
      },
      { args: ["logId=12"], stdout: big },
      { args: ["logId=14"], stdout: "lint: 1 problema" },
    ]);
    const log = await new AzureDevOpsCli().buildLog({ cwd: tempDir(), url: PR, buildId: "88" });
    expect(log.startsWith("### Run tests\n")).toBe(true);
    expect(log).toContain("ERRO: 3 testes falharam");
    expect(log).toContain("### Lint\nlint: 1 problema");
    expect(log).not.toContain("### Restore");
    const tests = log.slice(log.indexOf("### Run tests"), log.indexOf("### Lint"));
    expect(Buffer.byteLength(tests)).toBeLessThanOrEqual(16 * 1024 + 64);
    expect(tests).toContain("[…]");
    // The log of a task is fetched as plain text, from the build's route.
    const fetched = az.calls().find((args) => args.includes("logId=12")) ?? [];
    expect(fetched).toContain("buildId=88");
    expect(fetched).toContain("--accept-media-type");
    expect(fetched).toContain("text/plain");
  });
});

/** A card with an open PR, a fake az on PATH and the watcher over them. */
async function watched(rules: FakeRule[]) {
  const az = fakeAz(rules);
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, prProvider: "azure-devops" });
  const card = ctx.board.createCard(project.id, { title: "Login", description: "d" });
  ctx.store.db
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open' WHERE id = ?")
    .run(PR, card.id);
  const triggers: WatchTrigger[] = [];
  const watcher = new PrWatcher({
    db: ctx.store.db,
    board: ctx.board,
    onTrigger: (trigger) => {
      triggers.push(trigger);
    },
  });
  return { az, ctx, project, card, watcher, triggers };
}

describe("vigiar-ado: the watcher", () => {
  test("it is off by default: a round asks the host nothing", async () => {
    const { az, card, watcher, triggers } = await watched([
      show("conflicts"),
      evaluations(evaluation("rejected", "CI", 88)),
      NO_COMMENTS,
    ]);
    expect(watcher.enabled(card.id)).toBe(false);
    await watcher.tick();
    expect(az.calls()).toEqual([]);
    expect(triggers).toEqual([]);
  });

  test("the project's default turns it on for its cards, and a card's own choice wins", async () => {
    const { project, card, watcher } = await watched([]);
    expect(watcher.settings(project.id)).toEqual({
      enabled: false,
      maxRounds: 3,
      checks: [],
      checkTimeoutMin: 10,
      budgetUsd: 5,
      maxTurns: 30,
      persona: "revisor",
      maxFailures: 2,
      dailyUsd: 20,
    });
    watcher.setSettings(project.id, { enabled: true, maxRounds: 2 });
    expect(watcher.settings(project.id)).toMatchObject({ enabled: true, maxRounds: 2 });
    expect(watcher.enabled(card.id)).toBe(true);
    watcher.setEnabled(card.id, false);
    expect(watcher.enabled(card.id)).toBe(false);
    watcher.setEnabled(card.id, null);
    expect(watcher.enabled(card.id)).toBe(true);
    watcher.setSettings(project.id, { enabled: false });
    watcher.setEnabled(card.id, true);
    expect(watcher.enabled(card.id)).toBe(true);
  });

  test("it fires on what got worse: a failing build, a new conflict, a new comment of a person", async () => {
    const { az, card, watcher, triggers } = await watched([
      show("succeeded"),
      evaluations(evaluation("approved", "CI", 88)),
      NO_COMMENTS,
    ]);
    watcher.setEnabled(card.id, true);
    // Everything is green: nothing to do.
    await watcher.tick();
    expect(triggers).toEqual([]);
    // The build fails and the PR starts to conflict.
    az.respond([show("conflicts"), evaluations(evaluation("rejected", "CI", 88)), NO_COMMENTS]);
    await watcher.tick();
    expect(triggers.map((t) => [t.cardId, t.failed.map((c) => c.name), t.conflicts])).toEqual([
      [card.id, ["CI"], true],
    ]);
    // The same state again is not news.
    await watcher.tick();
    expect(triggers).toHaveLength(1);
    // The build passes (nothing to fix), then fails again: that is news.
    az.respond([show("succeeded"), evaluations(evaluation("approved", "CI", 88)), NO_COMMENTS]);
    await watcher.tick();
    expect(triggers).toHaveLength(1);
    az.respond([show("succeeded"), evaluations(evaluation("rejected", "CI", 91)), NO_COMMENTS]);
    await watcher.tick();
    expect(triggers).toHaveLength(2);
    expect(triggers[1]).toMatchObject({ conflicts: false });
    expect(triggers[1]?.failed.map((c) => [c.name, c.buildId])).toEqual([["CI", "91"]]);
    // A comment of a person is news once; the system's and the same one again are not.
    const thread = (id: number, type: string, status = "active") => ({
      id,
      status,
      threadContext: { filePath: "/src/login.ts", rightFileStart: { line: 3 } },
      comments: [
        {
          id: 1,
          author: { displayName: "Ana", uniqueName: "ana@acme.com" },
          content: `troque isso ${id}`,
          commentType: type,
        },
      ],
    });
    az.respond([
      show("succeeded"),
      evaluations(evaluation("approved", "CI", 91)),
      {
        args: ["pullRequestThreads"],
        stdout: JSON.stringify({
          value: [thread(1, "text"), thread(2, "system"), thread(3, "text", "fixed")],
        }),
      },
    ]);
    await watcher.tick();
    expect(triggers).toHaveLength(3);
    expect(triggers[2]?.comments.map((c) => [c.id, c.body])).toEqual([["1/1", "troque isso 1"]]);
    await watcher.tick();
    expect(triggers).toHaveLength(3);
  });

  test("a policy that is not a build (the reviewers) is shown but never fires a round", async () => {
    const { card, watcher, triggers } = await watched([
      show("succeeded"),
      evaluations(evaluation("rejected", "Required reviewers"), evaluation("approved", "CI", 88)),
      NO_COMMENTS,
    ]);
    watcher.setEnabled(card.id, true);
    await watcher.tick();
    expect(triggers).toEqual([]);
  });

  test("a PR that is no longer open is not looked at, and the watcher survives a host that fails", async () => {
    const { az, ctx, card, watcher, triggers } = await watched([
      show("conflicts"),
      evaluations(evaluation("rejected", "CI", 88)),
      NO_COMMENTS,
    ]);
    watcher.setEnabled(card.id, true);
    ctx.store.db.query("UPDATE cards SET pr_state = 'merged' WHERE id = ?").run(card.id);
    await watcher.tick();
    expect(az.calls()).toEqual([]);
    ctx.store.db.query("UPDATE cards SET pr_state = 'open' WHERE id = ?").run(card.id);
    az.respond([{ args: ["repos", "pr", "show"], code: 1 }]);
    await watcher.tick();
    expect(triggers).toEqual([]);
  });

  test("a look in flight when the PR stops being open fires nothing", async () => {
    const { ctx, card } = await watched([]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: PrProvider = {
      create: async () => PR,
      url: async () => null,
      status: async () => ({ state: "open", checks: null }),
      comments: async () => [],
      buildLog: async () => "",
      health: async () => {
        await gate;
        return {
          checks: [{ name: "CI", state: "failing", kind: "build", buildId: "88" }],
          conflicts: false,
        };
      },
    };
    const fired: WatchTrigger[] = [];
    const watcher = new PrWatcher({
      db: ctx.store.db,
      board: ctx.board,
      provider: () => provider,
      onTrigger: (trigger) => {
        fired.push(trigger);
      },
    });
    watcher.setEnabled(card.id, true);
    const inFlight = watcher.tick();
    await Bun.sleep(20);
    ctx.store.db.query("UPDATE cards SET pr_state = 'merged' WHERE id = ?").run(card.id);
    release();
    await inFlight;
    expect(fired).toEqual([]);
  });

  test("a watcher that stops reads nothing more, and a look in flight saves and fires nothing", async () => {
    const { ctx, card } = await watched([]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    const provider = (slow: boolean): PrProvider => ({
      create: async () => PR,
      url: async () => null,
      status: async () => ({ state: "open", checks: null }),
      comments: async () => [],
      buildLog: async () => "",
      health: async () => {
        asked++;
        if (slow) await gate;
        return {
          checks: [{ name: "CI", state: "failing", kind: "build", buildId: "88" }],
          conflicts: false,
        };
      },
    });
    const fired: WatchTrigger[] = [];
    const make = (slow: boolean, into: WatchTrigger[]) =>
      new PrWatcher({
        db: ctx.store.db,
        board: ctx.board,
        provider: () => provider(slow),
        onTrigger: (trigger) => {
          into.push(trigger);
        },
      });
    const watcher = make(true, fired);
    watcher.setEnabled(card.id, true);
    const inFlight = watcher.tick();
    await Bun.sleep(20);
    watcher.stop();
    release();
    await inFlight;
    expect(fired).toEqual([]);
    const asking = asked;
    await watcher.tick();
    expect(asked).toBe(asking);
    // Nothing was saved either: a watcher that starts later finds everything new.
    const later: WatchTrigger[] = [];
    await make(false, later).tick();
    expect(later.map((t) => t.failed.map((c) => c.name))).toEqual([["CI"]]);
  });
});
