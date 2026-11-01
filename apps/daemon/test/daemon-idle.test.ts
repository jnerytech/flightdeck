import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Automations } from "../src/automations/automations.ts";
import type { PrProvider } from "../src/board/pr.ts";
import { Budgets } from "../src/costs/budgets.ts";
import { startDaemon } from "../src/main.ts";
import { PrWatch } from "../src/watch/service.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { probeTimers } from "./timer-probe.ts";

// Real git and a daemon: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const probe = () => {
  const timers = probeTimers();
  cleanups.push(timers.restore);
  return timers;
};

/**
 * The timers an idle daemon owns, whatever the features: the transcript index, the connection
 * heartbeat, the external sessions' sweep, the messaging sweep and the daily maintenance.
 * Adding another is a decision: it goes here, or it starts only when its feature is used.
 */
const IDLE_TIMERS = [
  "central/external.ts 60000",
  "history/indexer.ts 10000",
  "main.ts 300000",
  "maintenance/maintenance.ts 86400000",
  "server.ts 15000",
];

describe("daemon-idle: what a started daemon keeps running", () => {
  test("with no optional feature in use, the daemon owns exactly these timers", async () => {
    const timers = probe();
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: "t".repeat(32),
        dataDir: join(dir, "data"),
        allowedRoots: [dir],
        runtime: "fake",
      }),
    );
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      {},
    );
    cleanups.push(() => running.stop());
    await Bun.sleep(300);
    expect(timers.list()).toEqual(IDLE_TIMERS);
    await running.stop();
    expect(timers.list()).toEqual([]);
  });

  test("a budget's period check runs only while there is a budget", () => {
    const timers = probe();
    const { store } = newBoard();
    cleanups.push(() => store.close());
    const budgets = new Budgets({ db: store.db });
    cleanups.push(() => budgets.stop());
    budgets.start();
    const mine = () => timers.list().filter((t) => t.startsWith("costs/"));
    expect(mine()).toEqual([]);
    const saved = budgets.set({ scope: "host", period: "day", limitUsd: 5, action: "notify" });
    expect(mine()).toEqual(["costs/budgets.ts 60000"]);
    budgets.remove(saved.id);
    expect(mine()).toEqual([]);
  });

  test("the automations' tick and issue search run only while an automation needs them", async () => {
    const timers = probe();
    const { board, store, repo } = newBoard();
    cleanups.push(() => board.stop());
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    const automations = new Automations({
      db: store.db,
      board,
      issues: { list: async () => [] } as unknown as ConstructorParameters<
        typeof Automations
      >[0]["issues"],
      autoApprove: { suspend: () => {} },
    });
    cleanups.push(() => automations.stop());
    automations.start();
    const action = { type: "start_workflow", workflow: "w" } as const;
    expect(timers.list().filter((t) => t.startsWith("automations/"))).toEqual([]);
    const cron = automations.save({
      projectId: project.id,
      name: "cron",
      trigger: { type: "cron", expr: "* * * * *", tz: "UTC" },
      action,
    });
    expect(timers.list().filter((t) => t.startsWith("automations/"))).toEqual([]);
    automations.toggle(cron.id, true, true);
    expect(timers.list().filter((t) => t.startsWith("automations/"))).toEqual([
      "automations/automations.ts 60000",
    ]);
    const labeled = automations.save({
      projectId: project.id,
      name: "labeled",
      trigger: { type: "issue_label", label: "auto" },
      action,
    });
    automations.toggle(labeled.id, true, true);
    expect(timers.list().filter((t) => t.startsWith("automations/"))).toEqual([
      "automations/automations.ts 300000",
      "automations/automations.ts 60000",
    ]);
    automations.toggle(cron.id, false, true);
    expect(timers.list().filter((t) => t.startsWith("automations/"))).toEqual([
      "automations/automations.ts 300000",
    ]);
    automations.remove(labeled.id, true);
    expect(timers.list().filter((t) => t.startsWith("automations/"))).toEqual([]);
  });

  test("a cron automation turned on after a long pause is not blamed for the slots before it was on, and one that was on at boot still is", async () => {
    probe();
    const { board, store, repo } = newBoard();
    cleanups.push(() => board.stop());
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    const clock = { now: Date.parse("2026-10-05T09:00:00Z") };
    const make = () =>
      new Automations({
        db: store.db,
        board,
        issues: { list: async () => [] } as unknown as ConstructorParameters<
          typeof Automations
        >[0]["issues"],
        autoApprove: { suspend: () => {} },
        clock: () => clock.now,
      });
    const automations = make();
    cleanups.push(() => automations.stop());
    automations.start();
    const cron = automations.save({
      projectId: project.id,
      name: "cron",
      trigger: { type: "cron", expr: "* * * * *", tz: "UTC" },
      action: { type: "start_workflow", workflow: "w" },
    });
    automations.toggle(cron.id, true, true);
    await automations.tick(clock.now);
    automations.toggle(cron.id, false, true);
    // Three hours with no cron automation on, so no tick was running.
    clock.now = Date.parse("2026-10-05T12:00:00Z");
    automations.toggle(cron.id, true, true);
    await automations.tick(clock.now + 60_000);
    const statuses = () => automations.runs(cron.id).map((run) => run.status);
    expect(statuses()).not.toContain("missed");
    // A daemon that boots with it already on records what it missed while it was down.
    automations.stop();
    clock.now = Date.parse("2026-10-05T14:00:00Z");
    const boot = make();
    cleanups.push(() => boot.stop());
    boot.start();
    expect(boot.runs(cron.id).map((run) => run.status)).toContain("missed");
  });

  test("the PR poll, and the watch that rides on it, run only while a PR is open", async () => {
    const timers = probe();
    const pr: { state: "open" | "closed" } = { state: "open" };
    const provider: PrProvider = {
      create: async () => "https://github.com/acme/app/pull/3",
      status: async () => ({ state: pr.state, checks: null }),
      url: async () => null,
      comments: async () => [],
      health: async () => ({ checks: [], conflicts: false }),
      buildLog: async () => "",
    };
    const { board, repo, root } = newBoard({ prPollIntervalMs: 30, prProvider: () => provider });
    cleanups.push(() => board.stop());
    const mine = () => timers.list().filter((t) => /^(board|watch)\//.test(t));
    expect(mine()).toEqual([]);
    const ticks: string[] = [];
    const watch = new PrWatch({
      board,
      watcher: { tick: async () => void ticks.push("tick"), stop: () => {} },
      fixer: { stop: () => {} },
      traces: {},
    } as unknown as ConstructorParameters<typeof PrWatch>[0]);
    cleanups.push(() => watch.stop());
    watch.start();
    expect(mine()).toEqual([]);
    const project = await board.addProject({
      path: repo,
      prProvider: "github",
      promptTemplate: "",
    });
    const card = board.createCard(project.id, { title: "PR", description: "faça" });
    await board.startCard(card.id);
    expect(await cardWhen(board, card.id, (c) => c.column === "review")).not.toBeNull();
    git(root, "init", "-q", "--bare", "remote.git");
    git(repo, "remote", "add", "origin", join(root, "remote.git"));
    await board.createPr(card.id);
    expect(mine()).toEqual(["board/board.ts 30"]);
    await Bun.sleep(100);
    expect(ticks.length).toBeGreaterThan(0);
    pr.state = "closed";
    expect(await cardWhen(board, card.id, (c) => c.prState === "closed")).not.toBeNull();
    await Bun.sleep(60);
    expect(mine()).toEqual([]);
    const settled = ticks.length;
    await Bun.sleep(100);
    expect(ticks.length).toBe(settled);
  });
});
