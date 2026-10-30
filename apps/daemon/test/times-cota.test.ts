import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { Quota } from "../src/quota/quota.ts";
import { Teams } from "../src/teams/teams.ts";
import { newBoard } from "./board-helpers.ts";
import { waitFor } from "./helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 28, 15, 0, 0);

async function setup() {
  const clock = { at: T0 };
  const quota = new Quota({ pauseAt: 0.9, now: () => clock.at });
  cleanups.push(() => quota.stop());
  const ctx = newBoard({ quota }, 1);
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const endpoints = new LocalEndpoints({
    manager: ctx.manager,
    external: new ExternalSessions({ db: ctx.store.db, staleAfterS: 3600 }),
    nameOf: () => null,
    projectKey: () => "github.com/acme/app",
    cardOf: (id) => ctx.board.projectForCwd(ctx.manager.get(id).cwd)?.card?.id ?? null,
    sendToLaunch: () => false,
  });
  cleanups.push(() => endpoints.stop());
  let ref: Teams | null = null;
  const messaging = new Messaging({
    db: ctx.store.db,
    host: "pc",
    endpoints,
    teamOf: (id) => ref?.teamOf(id) ?? null,
    clock: () => clock.at,
  });
  cleanups.push(() => messaging.stop());
  const teams = new Teams({
    db: ctx.store.db,
    board: ctx.board,
    manager: ctx.manager,
    messaging,
    host: "pc",
    quota,
    clock: () => clock.at,
  });
  ref = teams;
  cleanups.push(() => teams.stop());
  const frames: Array<{ state: string; reason: string | null }> = [];
  teams.watch((f) => frames.push({ state: f.team.state, reason: f.reason }));
  const reading = (utilization: number, resetsAt = clock.at + HOUR) =>
    quota.record([{ window: "five_hour", utilization, status: "allowed", resetsAt }]);
  const start = async (workers = 1) => {
    const team = await teams.create({ projectId: project.id, goal: "Uma tarefa.", workers });
    await waitFor(
      () => team.members.slice(1).every((m) => ctx.board.getCard(m.cardId as string).sessionId),
      { timeoutMs: 20_000 },
    );
    return team;
  };
  const stops = () =>
    messaging.list({}).filter((m) => m.kind === "system" && m.text.startsWith("STOP"));
  const resumes = () =>
    messaging.list({}).filter((m) => m.kind === "system" && m.text.startsWith("resume"));
  return { clock, quota, teams, messaging, ctx, frames, reading, start, stops, resumes };
}

describe("times-cota: a pausa e a retomada pela cota do plano", () => {
  test("ao cruzar o pauseAt o time pausa com STOP para todos; a leitura seguinte, ainda acima, não repete", async () => {
    const { teams, start, reading, stops, frames } = await setup();
    const team = await start(2);
    reading(0.5);
    expect(teams.get(team.id).state).toBe("active");
    reading(0.95);
    expect(teams.get(team.id)).toMatchObject({ state: "paused", pausedBy: "quota" });
    expect(stops()).toHaveLength(3);
    expect(stops()[0]?.text).toContain("cota");
    expect(frames.at(-1)).toMatchObject({ state: "paused" });
    expect(frames.at(-1)?.reason).toContain("cota");
    reading(0.97);
    expect(stops()).toHaveLength(3);
  });

  test("no reinício da janela o time retoma e avisa", async () => {
    const { teams, start, reading, resumes, frames, clock } = await setup();
    const team = await start(1);
    reading(0.95);
    clock.at += HOUR + 1;
    // The new window reads low.
    reading(0.1, clock.at + 5 * HOUR);
    expect(teams.get(team.id)).toMatchObject({ state: "active", pausedBy: null });
    expect(resumes()).toHaveLength(2);
    expect(resumes()[0]?.text).toContain("cota");
    expect(frames.at(-1)).toMatchObject({ state: "active" });
    expect(frames.at(-1)?.reason).toContain("cota");
  });

  test("o time que o usuário pausou continua pausado quando a cota volta, e a cota só retoma o que ela pausou", async () => {
    const { teams, start, reading, stops, resumes } = await setup();
    const byHand = await start(1);
    teams.pause(byHand.id);
    const before = stops().length;
    const byQuota = await start(1);
    reading(0.95);
    expect(teams.get(byQuota.id)).toMatchObject({ pausedBy: "quota" });
    // The one already paused by the user is not paused again, nor taken over by the quota.
    expect(teams.get(byHand.id)).toMatchObject({ state: "paused", pausedBy: "user" });
    expect(stops().length).toBe(before + 2);
    reading(0.1);
    expect(teams.get(byQuota.id).state).toBe("active");
    expect(teams.get(byHand.id)).toMatchObject({ state: "paused", pausedBy: "user" });
    expect(resumes()).toHaveLength(2);
  });

  test("retomar à mão um time pausado pela cota o libera, mas se a cota segue alta ele não nasce nem volta sozinho", async () => {
    const { teams, start, reading } = await setup();
    const team = await start(1);
    reading(0.95);
    expect(teams.resume(team.id)).toMatchObject({ state: "active", pausedBy: null });
  });

  test("com a cota acima do limite não se cria um time, e a mensagem diz até quando", async () => {
    const { teams, ctx, reading, clock } = await setup();
    const project = ctx.board.listProjects()[0];
    reading(0.95, clock.at + 2 * HOUR);
    let error = "";
    try {
      await teams.create({ projectId: project?.id as string, goal: "x", workers: 1 });
    } catch (e) {
      error = `${(e as { code?: string }).code}: ${(e as Error).message}`;
    }
    expect(error).toContain("invalid_state");
    expect(error).toContain("cota");
    expect(error).toContain(new Date(clock.at + 2 * HOUR).toISOString());
    expect(teams.list()).toEqual([]);
  });

  test("um time encerrado não é pausado nem retomado pela cota, e parar o serviço solta a assinatura", async () => {
    const { teams, start, reading, stops } = await setup();
    const team = await start(1);
    teams.close(team.id, true);
    reading(0.95);
    expect(teams.get(team.id).state).toBe("closed");
    expect(stops()).toEqual([]);
    teams.stop();
    reading(0.1);
    reading(0.99);
    expect(stops()).toEqual([]);
  });
});
