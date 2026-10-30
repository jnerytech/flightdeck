import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { Names } from "../src/names/names.ts";
import { trackNames } from "../src/names/track.ts";
import { Teams } from "../src/teams/teams.ts";
import { newBoard, whenChanged } from "./board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A team over the real board, with the standard names following every session it starts. */
async function setup() {
  const ctx = newBoard({}, 1);
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const external = new ExternalSessions({ db: ctx.store.db, staleAfterS: 3600 });
  const cardOf = (id: string) => ctx.board.projectForCwd(ctx.manager.get(id).cwd)?.card?.id ?? null;
  const endpoints = new LocalEndpoints({
    manager: ctx.manager,
    external,
    nameOf: () => null,
    projectKey: () => "github.com/acme/app",
    cardOf,
    sendToLaunch: () => false,
  });
  cleanups.push(() => endpoints.stop());
  const names = new Names(ctx.store.db);
  const messaging = new Messaging({ db: ctx.store.db, host: "pc", endpoints, names });
  cleanups.push(() => messaging.stop());
  const teams = new Teams({
    db: ctx.store.db,
    board: ctx.board,
    manager: ctx.manager,
    messaging,
    host: "pc",
    names,
    personas: { resolve: (id) => (["arquiteto", "qa"].includes(id) ? { id, name: id } : null) },
  });
  cleanups.push(() => teams.stop());
  cleanups.push(
    trackNames({
      names,
      manager: ctx.manager,
      external,
      projectOf: (cwd) => ctx.board.projectForCwd(cwd)?.project.path ?? cwd,
      cardOf,
      personaOf: (id) => {
        const card = cardOf(id);
        return card ? teams.personaOfCard(card) : null;
      },
    }),
  );
  return { ...ctx, project, names, teams };
}

describe("nomes-sessao: os times", () => {
  test("a coordenadora com persona leva o nome dela, e o apelido de antes continua valendo", async () => {
    const { teams, names, project } = await setup();
    const team = await teams.create({
      goal: "Implementar o login.",
      workers: 0,
      projectId: project.id,
      coordinatorPersona: "arquiteto",
    });
    const coordinator = names.get(team.coordinator as string);
    expect(coordinator?.display).toBe("repo · arquiteto · 1");
    expect(coordinator?.aliases).toEqual(["repo-geral-1", "repo-arquiteto-1"]);
    expect(names.resolve("repo-geral-1")).toBe(team.coordinator as string);
  });

  test("cada executora leva a persona do seu card e o número do card, desde a primeira sessão", async () => {
    const { teams, names, project, board } = await setup();
    const team = await teams.create({
      goal: "Implementar o login.",
      workers: 2,
      projectId: project.id,
      workerPersonas: ["qa"],
    });
    const sessions = await Promise.all(
      team.members
        .slice(1)
        .map((member) =>
          whenChanged(board, () => board.getCard(member.cardId as string).sessionId),
        ),
    );
    expect(sessions.map((id) => names.get(id as string)?.display)).toEqual([
      "repo · qa · card 1",
      "repo · geral · card 2",
    ]);
    expect(names.get(sessions[0] as string)?.aliases).toEqual(["repo-qa-card-1"]);
  });

  test("trocar a persona de um membro em andamento renomeia a sessão, guardando o apelido de antes", async () => {
    const { teams, names, project } = await setup();
    const team = await teams.create({
      goal: "Implementar o login.",
      workers: 0,
      projectId: project.id,
    });
    const coordinator = team.coordinator as string;
    expect(names.get(coordinator)?.display).toBe("repo · geral · 1");
    await teams.update({
      team: team.id,
      persona: { member: team.members[0]?.address as string, persona: "qa" },
    });
    expect(names.get(coordinator)).toMatchObject({
      display: "repo · qa · 1",
      aliases: ["repo-geral-1", "repo-qa-1"],
    });
  });
});
