import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { Quota } from "../src/quota/quota.ts";
import { cardWhen, gitRepo, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A quota on a manual clock, already over `pauseAt` (or at `status`) until a minute from now. */
function hotQuota(
  pauseAt: number | null,
  utilization = 0.95,
  status: "allowed" | "rejected" = "allowed",
) {
  const time = manualTime();
  const quota = new Quota({ pauseAt, now: time.now, timers: time.timers });
  cleanups.push(() => quota.stop());
  const resetsAt = time.now() + 60_000;
  quota.record([{ window: "five_hour", utilization, status, resetsAt }]);
  return { ...time, quota, resetsAt };
}

async function boardWith(quota: Quota) {
  const ctx = newBoard({ quota });
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = (title: string) => ctx.board.createCard(project.id, { title, description: "oi" });
  return { ...ctx, project, card };
}

describe("cota-fila", () => {
  test("acima do pauseAt, o card novo fica na fila com motivo quota e sai sozinho no reinício", async () => {
    const hot = hotQuota(0.9);
    const { board, card } = await boardWith(hot.quota);
    const c = card("Primeiro");
    const queued = await board.startCard(c.id);
    expect(queued).toMatchObject({
      queued: true,
      queueReason: "quota",
      quotaUntil: new Date(hot.resetsAt).toISOString(),
      sessionId: null,
    });
    await Bun.sleep(50);
    expect(board.getCard(c.id)).toMatchObject({ queued: true, sessionId: null });
    hot.advance(60_000);
    const started = await cardWhen(board, c.id, (x) => x.sessionId !== null);
    expect(started).toMatchObject({ queued: false, queueReason: null, quotaUntil: null });
  });

  test("status rejected também segura; abaixo do pauseAt o card entra direto", async () => {
    const rejected = hotQuota(0.9, 0.5, "rejected");
    const first = await boardWith(rejected.quota);
    const a = first.card("Recusado");
    expect((await first.board.startCard(a.id)).queueReason).toBe("quota");
    const cool = hotQuota(0.9, 0.5);
    const second = await boardWith(cool.quota);
    const b = second.card("Livre");
    await second.board.startCard(b.id);
    expect(
      (await cardWhen(second.board, b.id, (x) => x.sessionId !== null))?.queueReason,
    ).toBeNull();
  });

  test("um card na fila por vaga diz que é por vaga", async () => {
    const cool = hotQuota(0.9, 0.1);
    const ctx = newBoard({ quota: cool.quota, maxParallelRuns: 1 });
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const holder = ctx.board.createCard(project.id, { title: "Segura", description: "[tool] x" });
    await ctx.board.startCard(holder.id);
    await cardWhen(ctx.board, holder.id, (c) => c.sessionStatus === "awaiting_permission");
    const other = ctx.board.createCard(project.id, { title: "Espera", description: "oi" });
    expect(await ctx.board.startCard(other.id)).toMatchObject({
      queued: true,
      queueReason: "slot",
    });
  });

  test("pauseAt null desliga a fila por cota", async () => {
    const off = hotQuota(null, 0.99, "rejected");
    const { board, card } = await boardWith(off.quota);
    const c = card("Sem fila");
    await board.startCard(c.id);
    expect((await cardWhen(board, c.id, (x) => x.sessionId !== null))?.queueReason).toBeNull();
  });

  test("sessão manual não é bloqueada pela cota", async () => {
    const hot = hotQuota(0.9);
    const { manager, root } = await boardWith(hot.quota);
    const { sessionId } = manager.create({ cwd: root, prompt: "manual" });
    expect(await poll(() => manager.get(sessionId).status === "idle", 3000)).toBe(true);
  });

  test("workflow espera a cota antes do próximo turno de agente e segue no reinício", async () => {
    const time = manualTime();
    const quota = new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers });
    cleanups.push(() => quota.stop());
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[tool] a' }\n  - id: b\n    agent: { prompt: b }\n";
    const ctx = await workflowCard(yaml, { board: { quota } });
    cleanups.push(() => ctx.board.stop());
    await ctx.start();
    const asking = await ctx.runWhen(
      (r) => ctx.store.pendingPermissions(r.steps[0]?.sessionId ?? "").length > 0,
    );
    const resetsAt = time.now() + 120_000;
    quota.record([{ window: "seven_day", utilization: 0.97, status: "allowed", resetsAt }]);
    ctx.allow(asking?.steps[0]?.sessionId);
    const waiting = await ctx.runWhen((r) => r.quotaUntil !== null);
    expect(waiting).toMatchObject({
      status: "running",
      quotaUntil: new Date(resetsAt).toISOString(),
    });
    expect(waiting?.steps.map((s) => s.stepId)).toEqual(["a"]);
    await Bun.sleep(50);
    expect(ctx.run()?.steps).toHaveLength(1);
    time.advance(120_000);
    const done = await ctx.runWhen((r) => r.status === "completed");
    expect(done).toMatchObject({ quotaUntil: null });
    expect(done?.steps.map((s) => s.stepId)).toEqual(["a", "b"]);
  });

  test("concluir o card enquanto o workflow espera a cota encerra a execução sem seguir", async () => {
    const time = manualTime();
    const quota = new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers });
    cleanups.push(() => quota.stop());
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[tool] a' }\n  - id: b\n    agent: { prompt: b }\n";
    const ctx = await workflowCard(yaml, { board: { quota } });
    cleanups.push(() => ctx.board.stop());
    await ctx.start();
    const asking = await ctx.runWhen(
      (r) => ctx.store.pendingPermissions(r.steps[0]?.sessionId ?? "").length > 0,
    );
    quota.record([
      { window: "five_hour", utilization: 1, status: "rejected", resetsAt: time.now() + 1000 },
    ]);
    ctx.allow(asking?.steps[0]?.sessionId);
    expect(await ctx.runWhen((r) => r.quotaUntil !== null)).not.toBeNull();
    await ctx.board.completeCard(ctx.card.id, true);
    expect(ctx.run()).toMatchObject({ status: "failed", quotaUntil: null });
    time.advance(1000);
    await Bun.sleep(100);
    expect(ctx.run()?.steps.map((s) => s.stepId)).toEqual(["a"]);
    expect(ctx.run()?.status).toBe("failed");
  });

  test("no daemon, o board usa a cota do host", async () => {
    const { root, repo } = gitRepo();
    const file = join(root, "config.json");
    const token = "fila-token-0123456789abcdef";
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token,
        dataDir: join(root, "data"),
        allowedRoots: [root],
        history: { roots: [join(root, "nada")] },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token, client: "t" });
    const resets = Math.floor(Date.now() / 1000) + 600;
    await client.request("session.create", {
      cwd: root,
      prompt: `[ratelimit:five_hour=0.99@${resets}]`,
    });
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      const state = await client.data<{ windows: unknown[] }>("quota.get", {});
      blocked = (state?.windows.length ?? 0) > 0;
      if (!blocked) await Bun.sleep(20);
    }
    const project = await client.data<{ id: string }>("project.add", {
      path: repo,
      promptTemplate: "",
    });
    const card = await client.data<{ id: string }>("card.create", {
      projectId: project?.id,
      title: "Na cota",
      description: "oi",
    });
    const started = await client.data<{ queueReason: string | null }>("card.start", {
      cardId: card?.id,
    });
    expect(started?.queueReason).toBe("quota");
  });
});
