import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Quota } from "../../src/quota/quota.ts";
import { automationsRig, fired, NET, UTC } from "../support/automations.ts";

setDefaultTimeout(NET * 2);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const { fake, setup } = automationsRig(cleanups);

describe("automacoes: cron", () => {
  test("cron: dispara no minuto certo, no fuso dado, uma vez por minuto; desligada nunca", async () => {
    const { automations, created, on, time } = await setup();
    const sp = on({
      name: "SP",
      trigger: { type: "cron", expr: "30 9 * * *", tz: "America/Sao_Paulo" },
    });
    const utc = on({ name: "UTC", trigger: { type: "cron", expr: "30 9 * * *", tz: "UTC" } });
    const off = created({
      name: "Desligada",
      trigger: { type: "cron", expr: "* * * * *", tz: "UTC" },
    });
    const tick = async (text: string) => {
      time.now = UTC(text);
      await automations.tick(time.now);
    };
    await tick("2026-10-05T09:29:00Z");
    await tick("2026-10-05T09:30:00Z");
    await tick("2026-10-05T09:30:30Z");
    await tick("2026-10-05T12:30:00Z");
    await tick("2026-10-05T12:31:00Z");
    expect(fired(automations, utc.id).map((r) => r.firedAt)).toEqual(["2026-10-05T09:30:00.000Z"]);
    expect(fired(automations, sp.id).map((r) => r.firedAt)).toEqual(["2026-10-05T12:30:00.000Z"]);
    expect(automations.runs(off.id)).toEqual([]);
  });

  test("cron: listas, faixas, passos, e dia do mês ou da semana quando os dois estão", async () => {
    const { automations, on, time } = await setup();
    const steps = on({
      name: "Passos",
      trigger: { type: "cron", expr: "*/15 8-9 * * 1-5", tz: "UTC" },
    });
    const dayOr = on({ name: "Dia", trigger: { type: "cron", expr: "0 0 1 * 1", tz: "UTC" } });
    const list = on({ name: "Lista", trigger: { type: "cron", expr: "5,7 22 * 10 *", tz: "UTC" } });
    const sunday = on({ name: "Domingo", trigger: { type: "cron", expr: "0 6 * * 7", tz: "UTC" } });
    const tick = async (text: string) => {
      time.now = UTC(text);
      await automations.tick(time.now);
    };
    // Thursday 1, Friday 2, Monday 5, Saturday 10 and Sunday 11 of October 2026, in order.
    for (const at of [
      "2026-10-01T00:00:00Z",
      "2026-10-02T00:00:00Z",
      "2026-10-02T22:05:00Z",
      "2026-10-02T22:06:00Z",
      "2026-10-02T22:07:00Z",
      "2026-10-05T00:00:00Z",
      "2026-10-05T08:00:00Z",
      "2026-10-05T08:15:00Z",
      "2026-10-05T08:20:00Z",
      "2026-10-05T09:45:00Z",
      "2026-10-05T10:00:00Z",
      "2026-10-10T08:00:00Z",
      "2026-10-11T06:00:00Z",
    ]) {
      await tick(at);
    }
    const when = (id: string) =>
      fired(automations, id)
        .map((r) => r.firedAt.slice(5, 16))
        .reverse();
    expect(when(steps.id)).toEqual(["10-05T08:00", "10-05T08:15", "10-05T09:45"]);
    expect(when(dayOr.id)).toEqual(["10-01T00:00", "10-05T00:00"]);
    expect(when(list.id)).toEqual(["10-02T22:05", "10-02T22:07"]);
    expect(when(sunday.id)).toEqual(["10-11T06:00"]);
  });

  test("cron + start_workflow: cria o card com o nome da automação e inicia o workflow confiado", async () => {
    const { automations, on, board, project, time } = await setup();
    const a = on({
      name: "Revisão diária",
      action: {
        type: "start_workflow",
        workflow: "wf",
        description: "olhe os PRs",
      },
    });
    await automations.tick(time.now);
    const [run] = automations.runs(a.id);
    expect(run).toMatchObject({ status: "ok", cause: expect.stringContaining("12:00") });
    const card = board
      .getBoard(project.id)
      .columns.flatMap((c) => c.cards)
      .find((c) => c.title === "Revisão diária");
    expect(card).toMatchObject({ description: "olhe os PRs" });
    expect(run?.detail).toContain(card?.id ?? "?");
    expect(board.getCard(card?.id ?? "").workflowRunId).not.toBeNull();
  });

  test("disparo perdido com o daemon parado: só vira missed no boot, os dez mais recentes, e nada é executado", async () => {
    const { automations, make, on, board, project, time } = await setup();
    const daily = on({ name: "Diária", trigger: { type: "cron", expr: "30 9 * * *", tz: "UTC" } });
    const minutely = on({
      name: "Minuto",
      trigger: { type: "cron", expr: "* * * * *", tz: "UTC" },
    });
    time.now = UTC("2026-10-05T09:00:00Z");
    await automations.tick(time.now);
    automations.stop();
    const cardsBefore = board.getBoard(project.id).columns.flatMap((c) => c.cards).length;
    time.now = UTC("2026-10-05T12:00:00Z");
    const boot = make();
    boot.start();
    boot.stop();
    const missed = (id: string) => boot.runs(id).filter((r) => r.status === "missed");
    expect(missed(daily.id).map((r) => r.firedAt)).toEqual(["2026-10-05T09:30:00.000Z"]);
    expect(missed(minutely.id)).toHaveLength(10);
    expect(missed(minutely.id)[0]?.firedAt).toBe("2026-10-05T12:00:00.000Z");
    expect(board.getBoard(project.id).columns.flatMap((c) => c.cards)).toHaveLength(cardsBefore);
    // The slots that were recorded are not fired later.
    await boot.tick(time.now);
    expect(fired(boot, daily.id)).toEqual([]);
  });

  test("primeiro boot não tem o que ter perdido; uma pausa longa no meio (suspensão) registra missed e dispara só o recente", async () => {
    const { automations, on, time } = await setup();
    const old = on({ name: "Antiga", trigger: { type: "cron", expr: "30 9 * * *", tz: "UTC" } });
    const recent = on({
      name: "Recente",
      trigger: { type: "cron", expr: "0 12 * * *", tz: "UTC" },
    });
    // The first time the scheduler looks there is no past, so nothing can have been missed.
    time.now = UTC("2026-10-05T09:00:00Z");
    automations.start();
    expect(automations.runs(old.id)).toEqual([]);
    time.now = UTC("2026-10-05T12:00:00Z");
    await automations.tick(time.now);
    expect(automations.runs(old.id).map((r) => r.status)).toEqual(["missed"]);
    expect(fired(automations, recent.id)).toHaveLength(1);
    automations.stop();
  });

  test("limite por dia: passou de maxRunsPerDay vira limited e não executa; no dia seguinte volta", async () => {
    const { automations, on, time } = await setup();
    const a = on({ maxRunsPerDay: 2 });
    for (const at of ["2026-10-05T12:00:00Z", "2026-10-05T12:01:00Z", "2026-10-05T12:02:00Z"]) {
      time.now = UTC(at);
      await automations.tick(time.now);
    }
    time.now = UTC("2026-10-06T12:00:00Z");
    await automations.tick(time.now);
    // The day-long gap records the slots it skipped as missed (not runs), and the late tick
    // fires the three slots of its 2-minute grace: the new day starts over with the limit.
    const acted = automations
      .runs(a.id)
      .filter((r) => r.status !== "missed")
      .reverse();
    expect(acted.map((r) => (r.status === "failed" ? "executou" : r.status))).toEqual([
      "executou",
      "executou",
      "limited",
      "executou",
      "executou",
      "limited",
    ]);
  });

  test("um tick que encontra outro em andamento deixa os minutos dele para o próximo", async () => {
    const { automations, on, time } = await setup();
    const a = on();
    await Promise.all([automations.tick(time.now), automations.tick(time.now + 60_000)]);
    expect(fired(automations, a.id)).toHaveLength(1);
    await automations.tick(time.now + 60_000);
    expect(fired(automations, a.id)).toHaveLength(2);
  });

  test("um disparo que falha fica registrado com o motivo e não repete sozinho", async () => {
    const { automations, on, time, board, project } = await setup();
    const a = on({ action: { type: "start_workflow", workflow: "nao-existe" } });
    await automations.tick(time.now);
    await automations.tick(time.now);
    await automations.tick(time.now + 20_000);
    const runs = automations.runs(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("nao-existe"),
    });
    // A card that never started is not left behind in the Backlog.
    const titles = board.getBoard(project.id).columns.flatMap((c) => c.cards.map((x) => x.title));
    expect(titles).not.toContain("Auto");
  });

  test("as filas de orçamento e de cota continuam valendo: o card nasce e espera", async () => {
    const budget = await setup({
      board: { budgets: { blocked: () => true, watch: () => () => {} } },
    });
    const a = budget.on({ name: "Fila", action: { type: "start_workflow", workflow: "wf" } });
    await budget.automations.tick(budget.time.now);
    expect(budget.automations.runs(a.id)[0]?.status).toBe("ok");
    const waiting = budget.board
      .getBoard(budget.project.id)
      .columns.flatMap((c) => c.cards)
      .find((c) => c.title === "Fila");
    expect(waiting).toMatchObject({ queued: true, queueReason: "budget", sessionId: null });

    const quota = await setup({
      board: {
        quota: { blocked: () => ({ until: null }), watch: () => () => {} } as unknown as Quota,
      },
    });
    quota.on({ name: "Fila", action: { type: "start_workflow", workflow: "wf" } });
    await quota.automations.tick(quota.time.now);
    const held = quota.board
      .getBoard(quota.project.id)
      .columns.flatMap((c) => c.cards)
      .find((c) => c.title === "Fila");
    expect(held).toMatchObject({ queued: true, queueReason: "quota" });
  });
});
