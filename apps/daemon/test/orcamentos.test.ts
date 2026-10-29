import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Budgets, type BudgetUpdate } from "../src/costs/budgets.ts";
import { UsageIndexer } from "../src/costs/usage-indexer.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";
import { writeUsageTranscript } from "./usage-helpers.ts";

// Real git in temp repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "budgets-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Budgets on a manual clock (2026-10-15 12:00 UTC) over a store of their own. */
function setup(db = new EventStore(":memory:").db) {
  const time = manualTime(Date.UTC(2026, 9, 15, 12));
  const budgets = new Budgets({ db, now: time.now, day: utcDay, timers: time.timers });
  cleanups.push(() => budgets.stop());
  budgets.start();
  const frames: BudgetUpdate[] = [];
  budgets.watch((update) => frames.push(update));
  let n = 0;
  /** An entry of `cost` in project `key` on `day` (today when absent). */
  const spend = (cost: number, key = "kA", day = utcDay(time.now())) => {
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 0, 0, 0, 0, 0, ?)`,
    ).run(`m${++n}`, `${day}T12:00:00.000Z`, day, key, cost);
  };
  return { db, time, budgets, frames, spend };
}

const HOST_DAY = { scope: "host", period: "day", limitUsd: 10, action: "notify" } as const;

describe("orcamentos", () => {
  test("limiares de 50%, 80% e 100% disparam uma vez por período, também depois de reiniciar", () => {
    const { db, time, budgets, frames, spend } = setup();
    const budget = budgets.set(HOST_DAY);
    expect(budget).toEqual({
      id: budget.id,
      scope: "host",
      projectKey: null,
      period: "day",
      limitUsd: 10,
      action: "notify",
      createdAt: "2026-10-15T12:00:00.000Z",
      periodKey: "2026-10-15",
      spentUsd: 0,
      fraction: 0,
      crossed: [],
    });
    expect(budget.id).not.toBe("");
    const thresholds = () => frames.map((f) => f.threshold);
    spend(4);
    budgets.evaluate();
    spend(2);
    budgets.evaluate();
    budgets.evaluate();
    spend(3);
    budgets.evaluate();
    spend(2);
    budgets.evaluate();
    expect(thresholds()).toEqual([null, 0.5, 0.8, 1]);
    expect(frames.at(-1)?.budget).toMatchObject({ spentUsd: 11, crossed: [0.5, 0.8, 1] });
    // The next day is a new period: the alerts may fire again.
    time.advance(DAY);
    expect(frames.at(-1)).toMatchObject({
      threshold: null,
      budget: { periodKey: "2026-10-16", spentUsd: 0, crossed: [] },
    });
    spend(6);
    budgets.evaluate();
    expect(thresholds()).toEqual([null, 0.5, 0.8, 1, null, 0.5]);
    // A restart remembers what already fired.
    const again = new Budgets({ db, now: time.now, day: utcDay, timers: time.timers });
    const after: BudgetUpdate[] = [];
    again.watch((u) => after.push(u));
    again.evaluate();
    expect(after).toEqual([]);
    expect(again.list().map((b) => b.crossed)).toEqual([[0.5]]);
    // Created over its limit: one alert, with every threshold it went past.
    const small = budgets.set({ ...HOST_DAY, limitUsd: 1 });
    expect(frames.at(-1)).toMatchObject({ threshold: 1, budget: { id: small.id } });
    expect(small.crossed).toEqual([0.5, 0.8, 1]);
  });

  test("mês e projeto: só o que é do projeto e do mês corrente conta", () => {
    const { budgets, spend } = setup();
    spend(30);
    spend(20, "kA", "2026-10-01");
    spend(50, "kB");
    spend(40, "kA", "2026-09-30");
    const budget = budgets.set({
      scope: "project",
      projectKey: "kA",
      period: "month",
      limitUsd: 100,
      action: "queue",
    });
    expect(budget).toMatchObject({ periodKey: "2026-10", spentUsd: 50, fraction: 0.5 });
    expect(budgets.list()).toEqual([budget]);
  });

  test("validação: projeto sem chave e id desconhecido recusados; host ignora projectKey; editar mantém a criação", () => {
    const { time, budgets } = setup();
    const refused = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? "sem código";
      }
    };
    expect(
      refused(() => budgets.set({ scope: "project", period: "day", limitUsd: 5, action: "queue" })),
    ).toBe("bad_request");
    expect(refused(() => budgets.set({ ...HOST_DAY, id: "nada" }))).toBe("not_found");
    expect(refused(() => budgets.remove("nada"))).toBe("not_found");
    const host = budgets.set({ ...HOST_DAY, projectKey: "kA" });
    expect(host.projectKey).toBeNull();
    time.advance(1000);
    const edited = budgets.set({ ...HOST_DAY, id: host.id, limitUsd: 20 });
    expect(edited).toMatchObject({ id: host.id, limitUsd: 20, createdAt: host.createdAt });
    budgets.remove(host.id);
    expect(budgets.list()).toEqual([]);
  });

  test("queue em 100% bloqueia o escopo; limite maior ou o período seguinte soltam", () => {
    const { time, budgets, frames, spend } = setup();
    spend(6);
    const notify = budgets.set({ ...HOST_DAY, limitUsd: 5 });
    expect(budgets.blocked("kA")).toBe(false);
    budgets.remove(notify.id);
    const project = budgets.set({
      scope: "project",
      projectKey: "kA",
      period: "day",
      limitUsd: 5,
      action: "queue",
    });
    expect([budgets.blocked("kA"), budgets.blocked("kB")]).toEqual([true, false]);
    budgets.set({ ...project, limitUsd: 10 });
    expect(budgets.blocked("kA")).toBe(false);
    expect(frames.at(-1)).toMatchObject({ threshold: null, budget: { limitUsd: 10 } });
    const host = budgets.set({ ...HOST_DAY, limitUsd: 5, action: "queue" });
    expect([budgets.blocked("kA"), budgets.blocked("kB")]).toEqual([true, true]);
    time.advance(DAY);
    expect(budgets.blocked("kB")).toBe(false);
    expect(frames.at(-1)?.budget.id).toBe(host.id);
  });

  test("card novo do projeto bloqueado fica na fila com motivo budget; outro projeto e sessão manual seguem", async () => {
    const { budgets, spend } = setup();
    const ctx = newBoard({ budgets, projectKeys: { keyFor: (path) => `k:${basename(path)}` } });
    cleanups.push(() => ctx.board.stop());
    const outro = join(ctx.root, "outro");
    mkdirSync(outro);
    git(outro, "init", "-q", "-b", "main");
    writeFileSync(join(outro, "README.md"), "# outro\n");
    git(outro, "add", ".");
    git(outro, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "inicial");
    const repo = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const other = await ctx.board.addProject({ path: outro, promptTemplate: "" });
    spend(2, "k:repo");
    const budget = budgets.set({
      scope: "project",
      projectKey: "k:repo",
      period: "day",
      limitUsd: 1,
      action: "queue",
    });
    const held = ctx.board.createCard(repo.id, { title: "Segura", description: "oi" });
    expect(await ctx.board.startCard(held.id)).toMatchObject({
      queued: true,
      queueReason: "budget",
      sessionId: null,
    });
    const free = ctx.board.createCard(other.id, { title: "Livre", description: "oi" });
    await ctx.board.startCard(free.id);
    expect(
      (await cardWhen(ctx.board, free.id, (c) => c.sessionId !== null))?.queueReason,
    ).toBeNull();
    const manual = ctx.manager.create({ cwd: ctx.repo, prompt: "oi" });
    expect(await poll(() => ctx.manager.get(manual.sessionId).status === "idle")).toBe(true);
    expect(ctx.board.getCard(held.id)).toMatchObject({ queued: true, queueReason: "budget" });
    budgets.set({ ...budget, limitUsd: 10 });
    const started = await cardWhen(ctx.board, held.id, (c) => c.sessionId !== null);
    expect(started).toMatchObject({ queued: false, queueReason: null });
  });

  test("cada passada de uso avisa quem reavalia os orçamentos", async () => {
    const store = new EventStore(":memory:");
    const root = join(tempDir("fd-budget-"), "projects");
    mkdirSync(root);
    writeUsageTranscript(root, "proj", "/work/app");
    const passes: number[] = [];
    await new UsageIndexer({
      db: store.db,
      roots: [root],
      projectKey: () => "k",
      pause: async () => {},
      onPass: (added) => passes.push(added),
    }).pass();
    expect(passes).toEqual([5]);
  });

  test("budget.list, budget.set, budget.remove e budget.watch pelo protocolo", async () => {
    const { budgets, spend } = setup();
    spend(6);
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      budgets,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data("budget.watch", {})).toBeUndefined();
    const made = await client.data<{ id: string; crossed: number[] }>("budget.set", HOST_DAY);
    expect(made?.crossed).toEqual([0.5]);
    expect(
      (await client.data<{ budgets: Array<{ id: string }> }>("budget.list", {}))?.budgets.map(
        (b) => b.id,
      ),
    ).toEqual([made?.id]);
    await client.request("budget.remove", { id: made?.id });
    expect(await client.data("budget.list", {})).toEqual({ budgets: [] });
    const updates = () => client.frames.filter((f) => f.type === "budget.updated");
    await poll(() => updates().length === 2);
    expect(updates().map((f) => [f.threshold, f.removed])).toEqual([
      [0.5, false],
      [null, true],
    ]);
    expect(await client.request("budget.set", { ...HOST_DAY, limitUsd: 0 })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
    expect(await client.request("budget.set", { ...HOST_DAY, scope: "project" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });
});
