import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { INSTRUCTIONS_VERSION } from "../../src/teams/domain/instructions.ts";
import { Teams } from "../../src/teams/teams.ts";
import { cardWhen, whenChanged } from "../support/board-helpers.ts";
import { cleanups, failure, NEW, setup, teardown } from "./teams-setup.ts";

setDefaultTimeout(30_000);
afterEach(teardown);

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
    await whenChanged(board, () => cards.every((c) => board.getCard(c.id).sessionId));
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

  test("um nome de time longo não repete a branch das executoras: o nome dos cards é cortado antes do número", async () => {
    const { teams, project, board } = await setup();
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      name: "Implementar o login com e-mail e senha, com testes completos",
    });
    await whenChanged(board, () =>
      team.members.slice(1).every((m) => board.getCard(m.cardId as string).sessionId),
    );
    const branches = team.members.slice(1).map((m) => board.getCard(m.cardId as string).branch);
    expect(new Set(branches).size).toBe(2);
    expect(team.members.map((m) => m.name)).toEqual([
      "Implementar o login com · coordenadora",
      "Implementar o login com · executora 1",
      "Implementar o login com · executora 2",
    ]);
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

  test("each member opens in the model the team gives it, and none means the persona's own", async () => {
    const started: Array<{ role: string; model: string | null }> = [];
    const { teams, project, board, manager } = await setup({
      startCoordinator: (input) => {
        started.push({ role: "coordinator", model: input.model });
        return manager.create({
          cwd: input.cwd,
          prompt: input.prompt,
          name: input.name,
          ...(input.model ? { model: input.model } : {}),
        });
      },
    });
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      coordinatorModel: "opus",
      workerModels: ["haiku", null],
    });
    expect(started).toEqual([{ role: "coordinator", model: "opus" }]);
    expect(team.members.map((m) => m.model)).toEqual(["opus", "haiku", null]);
    await whenChanged(board, () =>
      team.members.slice(1).every((m) => board.getCard(m.cardId as string).sessionId),
    );
    const modelOf = (member: { cardId: string | null; sessionId: string | null }) =>
      manager.get(
        (member.cardId ? board.getCard(member.cardId).sessionId : member.sessionId) as string,
      ).model;
    // The fake runtime reports its own model for the session nobody asked a model for.
    expect(team.members.map(modelOf)).toEqual(["opus", "haiku", "fake-model"]);
    // The model is kept with the team, so a later reading shows it too.
    expect(teams.get(team.id).members.map((m) => m.model)).toEqual(["opus", "haiku", null]);
  });

  test("the coordinator starts once the project of its folder has been looked up, and the lookup is skipped when the folder is known", async () => {
    const gate = Promise.withResolvers<void>();
    const asked: string[] = [];
    const started: string[] = [];
    let known = false;
    const { teams, project, manager } = await setup({
      warm: (cwd) => {
        asked.push(cwd);
        return known ? undefined : gate.promise;
      },
      startCoordinator: (input) => {
        started.push(input.cwd);
        return manager.create({ cwd: input.cwd, prompt: input.prompt, name: input.name });
      },
    });
    const creating = teams.create({ ...NEW, projectId: project.id, workers: 1 });
    await Bun.sleep(30);
    expect(asked).toEqual([project.path]);
    expect(started).toEqual([]);
    gate.resolve();
    await creating;
    expect(started).toEqual([project.path]);
    known = true;
    await teams.create({ ...NEW, projectId: project.id, workers: 1 });
    expect(started).toEqual([project.path, project.path]);
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
    await whenChanged(board, () => board.getCard(worker?.cardId as string).sessionId);
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

describe("times: o estado do time", () => {
  test("team_status traz os membros com estado, o último relato de cada um e as contagens", async () => {
    const { teams, project, messaging, board } = await setup();
    const team = await teams.create({ ...NEW, projectId: project.id });
    const worker = team.members[1];
    await whenChanged(board, () => board.getCard(worker?.cardId as string).sessionId);
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

describe("times: acompanhar", () => {
  test("quem assiste recebe cada mudança e pode parar de assistir", async () => {
    const ctx = await setup();
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    const seen: string[] = [];
    const off = ctx.teams.watch((frame) => seen.push(frame.team.state));
    ctx.teams.pause(team.id);
    off();
    ctx.teams.resume(team.id);
    expect(seen).toEqual(["paused"]);
  });
});
