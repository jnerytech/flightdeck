import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamsUpdatedFrame } from "@flightdeck/protocol";
import { ExternalSessions } from "../src/central/external.ts";
import type { FlightdeckError } from "../src/errors.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { INSTRUCTIONS_VERSION } from "../src/teams/instructions.ts";
import { Teams, type TeamsOptions } from "../src/teams/teams.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { waitFor } from "./helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(over: Partial<TeamsOptions> = {}) {
  const ctx = newBoard({}, 1);
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const external = new ExternalSessions({ db: ctx.store.db, staleAfterS: 3600 });
  const endpoints = new LocalEndpoints({
    manager: ctx.manager,
    external,
    nameOf: () => null,
    projectKey: () => "github.com/acme/app",
    cardOf: (id) => ctx.board.projectForCwd(ctx.manager.get(id).cwd)?.card?.id ?? null,
    sendToLaunch: () => false,
  });
  cleanups.push(() => endpoints.stop());
  // The messaging service learns the teams after they exist.
  let teamsRef: Teams | null = null;
  const messaging = new Messaging({
    db: ctx.store.db,
    host: "pc",
    endpoints,
    teamOf: (id) => teamsRef?.teamOf(id) ?? null,
  });
  cleanups.push(() => messaging.stop());
  const teams = new Teams({
    db: ctx.store.db,
    board: ctx.board,
    manager: ctx.manager,
    messaging,
    host: "pc",
    ...over,
  });
  teamsRef = teams;
  cleanups.push(() => teams.stop());
  const frames: TeamsUpdatedFrame[] = [];
  teams.watch((frame) => frames.push(frame));
  const sessionTexts = (sessionId: string) =>
    ctx.manager
      .eventsSince(sessionId, 0)
      .flatMap(({ event }) => (event.type === "message.user" ? [event.text] : []));
  return { ...ctx, project, endpoints, messaging, teams, frames, sessionTexts };
}

const failure = async (promise: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return "ok";
  } catch (error) {
    return `${(error as FlightdeckError).code}: ${(error as Error).message}`;
  }
};

const NEW = { goal: "Implementar o login com testes.", workers: 2 };

describe("times: criar", () => {
  test("cria a coordenadora e as executoras, cada uma num card, e a coordenadora começa com as instruções", async () => {
    const { teams, project, board, sessionTexts } = await setup();
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      name: "login",
      checks: ["bun test"],
    });
    expect(team).toMatchObject({
      name: "login",
      projectId: project.id,
      goal: NEW.goal,
      state: "active",
      pausedBy: null,
      instructionsVersion: INSTRUCTIONS_VERSION,
      checks: ["bun test"],
    });
    expect(team.members.map((m) => m.role)).toEqual(["coordinator", "worker", "worker"]);
    expect(team.members.map((m) => m.name)).toEqual([
      "login · coordenadora",
      "login · executora 1",
      "login · executora 2",
    ]);
    const coordinator = team.members[0];
    expect(team.coordinator).toBe(coordinator?.sessionId ?? null);
    expect(coordinator).toMatchObject({ cardId: null, address: `pc/${coordinator?.sessionId}` });

    // Each worker is a card of the project with a worktree, started with the worker instructions.
    const cards = team.members.slice(1).map((m) => board.getCard(m.cardId as string));
    expect(cards.map((c) => c.projectId)).toEqual([project.id, project.id]);
    await waitFor(() => cards.every((c) => board.getCard(c.id).sessionId), { timeoutMs: 8000 });
    for (const card of cards) {
      expect(card.title).toMatch(/^login · executora [12]$/);
      expect(card.description).toContain("espere a tarefa");
      expect(card.description).toContain(`pc/${team.coordinator}`);
    }

    // The coordinator got the cycle, the goal and the workers.
    const first = sessionTexts(coordinator?.sessionId as string)[0] ?? "";
    expect(first).toContain(`versão ${INSTRUCTIONS_VERSION}`);
    expect(first).toContain(NEW.goal);
    expect(first).toContain("login · executora 1");
    expect(first).toContain("`bun test`");
  });

  test("as personas passam por quem as resolve: a que não existe é recusada sem criar nada, a conhecida vai para a sessão", async () => {
    const started: Array<{ persona: string | null; name?: string; cardId?: string }> = [];
    const { teams, project, board, manager } = await setup({
      personas: { resolve: (id) => (["arquiteto", "qa"].includes(id) ? { id, name: id } : null) },
      startCoordinator: (input) => {
        started.push({ persona: input.persona, name: input.name });
        return manager.create({ cwd: input.cwd, prompt: input.prompt, name: input.name });
      },
      startWorker: async (cardId, persona) => {
        started.push({ persona, cardId });
        await board.startCard(cardId);
      },
    });
    const refused = await failure(
      teams.create({ ...NEW, projectId: project.id, coordinatorPersona: "inexistente" }),
    );
    expect(refused).toContain("bad_request");
    expect(refused).toContain("inexistente");
    expect(
      await failure(
        teams.create({ ...NEW, projectId: project.id, workerPersonas: ["qa", "nada"] }),
      ),
    ).toContain("nada");
    expect(board.getBoard(project.id).columns.flatMap((c) => c.cards)).toEqual([]);
    expect(teams.list()).toEqual([]);

    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      coordinatorPersona: "arquiteto",
      workerPersonas: ["qa"],
    });
    expect(team.members.map((m) => m.persona)).toEqual(["arquiteto", "qa", null]);
    expect(started.map((s) => s.persona)).toEqual(["arquiteto", "qa", null]);
  });

  test("recusa o projeto que não existe e mais executoras do que o limite não passa pelo protocolo", async () => {
    const { teams } = await setup();
    expect(await failure(teams.create({ ...NEW, projectId: "nada" }))).toContain("not_found");
  });
});

describe("times: os membros se falam", () => {
  test("a coordenadora manda para a executora, e as mensagens ficam registradas no time", async () => {
    const { teams, project, messaging, board } = await setup();
    const team = await teams.create({ ...NEW, projectId: project.id });
    const worker = team.members[1];
    await waitFor(() => board.getCard(worker?.cardId as string).sessionId, { timeoutMs: 8000 });
    const workerSession = board.getCard(worker?.cardId as string).sessionId as string;
    expect(teams.teamOf(team.coordinator as string)).toBe(team.id);
    expect(teams.teamOf(workerSession)).toBe(team.id);
    expect(teams.teamOf("outra")).toBeNull();
    const sent = messaging.send({
      as: { session: team.coordinator as string },
      to: `pc/${workerSession}`,
      text: "tarefa 1",
    });
    expect(sent.status).not.toBe("refused");
    expect(messaging.list({ team: team.id }).map((m) => m.text)).toEqual(["tarefa 1"]);
    // list reflects the live session id of the worker once its card has started.
    const listed = teams.get(team.id).members[1];
    expect(listed).toMatchObject({ sessionId: workerSession, address: `pc/${workerSession}` });
  });
});

describe("times: os controles", () => {
  async function running() {
    const ctx = await setup();
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    await waitFor(
      () => team.members.slice(1).every((m) => ctx.board.getCard(m.cardId as string).sessionId),
      { timeoutMs: 8000 },
    );
    const fresh = ctx.teams.get(team.id);
    return { ...ctx, team: fresh };
  }
  const stops = (messaging: Messaging) =>
    messaging.list({}).filter((m) => m.kind === "system" && m.text.startsWith("STOP"));

  test("pausar manda STOP a todos, retomar manda resume, e pausar duas vezes não repete", async () => {
    const { teams, messaging, team, frames } = await running();
    const paused = teams.pause(team.id);
    expect(paused).toMatchObject({ state: "paused", pausedBy: "user" });
    expect(stops(messaging)).toHaveLength(3);
    expect(stops(messaging)[0]?.text).toContain("ponto seguro");
    expect(teams.pause(team.id).state).toBe("paused");
    expect(stops(messaging)).toHaveLength(3);
    const resumed = teams.resume(team.id);
    expect(resumed).toMatchObject({ state: "active", pausedBy: null });
    expect(messaging.list({}).filter((m) => m.text.startsWith("resume"))).toHaveLength(3);
    expect(teams.resume(team.id).state).toBe("active");
    expect(frames.map((f) => f.team.state)).toContain("paused");
  });

  test("mandar a todos entrega o texto a cada membro", async () => {
    const { teams, team, messaging } = await running();
    const result = teams.message(team.id, "mudança de rumo: use SQLite");
    expect(result).toEqual({ delivered: 3, refused: 0 });
    expect(messaging.list({ team: team.id }).filter((m) => m.text.includes("SQLite"))).toHaveLength(
      3,
    );
  });

  test("trocar a persona de um membro registra e avisa a sessão; persona que não existe é recusada", async () => {
    const applied: Array<[string, string | null]> = [];
    const ctx = await setup({
      personas: { resolve: (id) => (id === "qa" ? { id, name: id } : null) },
      applyPersona: (sessionId, persona) => applied.push([sessionId, persona]),
    });
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    const target = team.members[0]?.address as string;
    const changed = await ctx.teams.update({
      team: team.id,
      persona: { member: target, persona: "qa" },
    });
    expect(changed.members[0]?.persona).toBe("qa");
    expect(applied).toEqual([[team.coordinator as string, "qa"]]);
    const cleared = await ctx.teams.update({
      team: team.id,
      persona: { member: target, persona: null },
    });
    expect(cleared.members[0]?.persona).toBeNull();
    expect(
      await failure(
        ctx.teams.update({ team: team.id, persona: { member: target, persona: "nada" } }),
      ),
    ).toContain("bad_request");
    expect(
      await failure(
        ctx.teams.update({ team: team.id, persona: { member: "pc/fantasma", persona: "qa" } }),
      ),
    ).toContain("not_found");
  });

  test("acrescentar uma executora cria o card dela e avisa a coordenadora; tirar uma tira só do time", async () => {
    const { teams, team, messaging, board } = await running();
    const grown = await teams.update({ team: team.id, addWorkers: 1 });
    expect(grown.members.map((m) => m.name).at(-1)).toBe(`${team.name} · executora 3`);
    expect(
      messaging.list({}).some((m) => m.kind === "system" && m.text.includes("executora 3")),
    ).toBe(true);
    const removed = grown.members[1];
    const shrunk = await teams.update({ team: team.id, removeMember: removed?.cardId as string });
    expect(shrunk.members).toHaveLength(3);
    expect(shrunk.members.some((m) => m.cardId === removed?.cardId)).toBe(false);
    // The card stays on the board: only the membership goes.
    expect(board.getCard(removed?.cardId as string).id).toBe(removed?.cardId as string);
    expect(
      await failure(teams.update({ team: team.id, removeMember: team.coordinator as string })),
    ).toContain("coordenadora");
    expect(await failure(teams.update({ team: team.id, removeMember: "nada" }))).toContain(
      "not_found",
    );
  });

  test("o objetivo e os checks mudam, e uma mensagem avisa a coordenadora", async () => {
    const { teams, team, messaging } = await running();
    const changed = await teams.update({
      team: team.id,
      goal: "novo objetivo",
      checks: ["bun test"],
    });
    expect(changed).toMatchObject({ goal: "novo objetivo", checks: ["bun test"] });
    expect(messaging.list({}).some((m) => m.text.includes("novo objetivo"))).toBe(true);
  });

  test("encerrar pede confirmação, avisa os membros e o time deixa de aceitar controles", async () => {
    const { teams, team, messaging } = await running();
    expect(await failure(() => teams.close(team.id, false))).toContain("confirm");
    const closed = teams.close(team.id, true);
    expect(closed.state).toBe("closed");
    expect(messaging.list({}).filter((m) => m.text.includes("encerrado"))).toHaveLength(3);
    expect(await failure(() => teams.pause(team.id))).toContain("encerrado");
    expect(await failure(() => teams.message(team.id, "oi"))).toContain("encerrado");
    expect(await failure(teams.update({ team: team.id, goal: "x" }))).toContain("encerrado");
    expect(teams.close(team.id, true).state).toBe("closed");
    expect(teams.teamOf(team.coordinator as string)).toBeNull();
  });

  test("um time que não existe é not_found", async () => {
    const { teams } = await running();
    expect(await failure(() => teams.get("nada"))).toContain("not_found");
    expect(await failure(() => teams.pause("nada"))).toContain("not_found");
  });
});

describe("times: o estado do time", () => {
  test("team_status traz os membros com estado, o último relato de cada um e as contagens", async () => {
    const { teams, project, messaging, board } = await setup();
    const team = await teams.create({ ...NEW, projectId: project.id });
    const worker = team.members[1];
    await waitFor(() => board.getCard(worker?.cardId as string).sessionId, { timeoutMs: 8000 });
    const workerSession = board.getCard(worker?.cardId as string).sessionId as string;
    await cardWhen(board, worker?.cardId as string, (c) => c.sessionStatus === "idle");
    messaging.send({
      as: { session: team.coordinator as string },
      to: `pc/${workerSession}`,
      text: "tarefa",
    });
    messaging.send({
      as: { session: workerSession },
      to: `pc/${team.coordinator}`,
      text: "pronto, commit abc123",
    });
    const status = teams.status(team.id);
    expect(status.team.id).toBe(team.id);
    expect(status.messages).toBe(2);
    const coordinator = status.members.find((m) => m.role === "coordinator");
    const first = status.members.find((m) => m.sessionId === workerSession);
    expect(first).toMatchObject({
      sent: 1,
      received: 1,
      lastReport: { text: "pronto, commit abc123" },
    });
    expect(coordinator).toMatchObject({ sent: 1, received: 1, lastReport: { text: "tarefa" } });
    expect(status.members.find((m) => m.cardId === team.members[2]?.cardId)?.lastReport).toBeNull();
  });
});

describe("times: guardar", () => {
  test("o time e o que o fez pausar sobrevivem a um novo serviço sobre o mesmo banco", async () => {
    const ctx = await setup();
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    ctx.teams.pause(team.id);
    const again = new Teams({
      db: ctx.store.db,
      board: ctx.board,
      manager: ctx.manager,
      messaging: ctx.messaging,
      host: "pc",
    });
    cleanups.push(() => again.stop());
    expect(again.list(ctx.project.id)).toHaveLength(1);
    expect(again.get(team.id)).toMatchObject({ state: "paused", pausedBy: "user", goal: NEW.goal });
    expect(again.list("outro-projeto")).toEqual([]);
  });
});
