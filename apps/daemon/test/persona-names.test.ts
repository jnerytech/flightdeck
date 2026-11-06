import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { Names } from "../src/names/names.ts";
import { trackNames } from "../src/names/track.ts";
import { EventStore } from "../src/store/event-store.ts";
import { Teams } from "../src/teams/teams.ts";
import { newBoard, whenChanged } from "./board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #101: a team session's name carries its persona. The daemon records each member's team,
 * role and number on the session's name, and the app composes the label in the person's language.
 * The address (the first alias) never changes.
 */
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
      teamOfCard: teams.teamOfCard.bind(teams),
    }),
  );
  return { ...ctx, project, names, teams };
}

describe("persona-names: the daemon records who a team session is (#101)", () => {
  test("each member's name record carries its team, role and number, and the address stays", async () => {
    const { teams, names, project, board } = await setup();
    const team = await teams.create({
      goal: "Implementar o login.",
      workers: 2,
      projectId: project.id,
      coordinatorPersona: "arquiteto",
      workerPersonas: ["qa"],
    });
    const workers = await Promise.all(
      team.members
        .slice(1)
        .map((member) =>
          whenChanged(board, () => board.getCard(member.cardId as string).sessionId),
        ),
    );
    const coordinator = names.get(team.coordinator as string);
    const recorded = [coordinator, ...workers.map((id) => names.get(id as string))].map(
      (name) => name?.team ?? null,
    );
    expect([
      recorded,
      team.members.map((member) => member.number ?? "none"),
      coordinator?.aliases,
      [coordinator, ...workers.map((id) => names.get(id as string))].map((n) => n?.standard),
    ]).toEqual([
      [
        { name: "Implementar o login.", role: "coordinator", number: null },
        { name: "Implementar o login.", role: "worker", number: 1 },
        { name: "Implementar o login.", role: "worker", number: 2 },
      ],
      [null, 1, 2],
      ["repo-geral-1", "repo-arquiteto-1"],
      [true, true, true],
    ]);
  });

  test("a worker added to a team saved before #101 gets the next free number", async () => {
    const { teams, project, store } = await setup();
    const team = await teams.create({
      goal: "Implementar o login.",
      workers: 1,
      projectId: project.id,
    });
    // A team saved before #101: its members carry no number, only their names.
    const row = store.db.query("SELECT members FROM teams WHERE id = ?").get(team.id) as {
      members: string;
    };
    const old = (JSON.parse(row.members) as Array<Record<string, unknown>>).map(
      ({ number: _number, ...member }) => member,
    );
    store.db.query("UPDATE teams SET members = ? WHERE id = ?").run(JSON.stringify(old), team.id);
    const grown = await teams.update({ team: team.id, addWorkers: 1 });
    expect(grown.members.map((member) => [member.role, member.number ?? "none"])).toEqual([
      ["coordinator", null],
      ["worker", 1],
      ["worker", 2],
    ]);
  });
});

describe("persona-names: a name says whether it is the standard one (#101)", () => {
  test("standard until renamed in Flightdeck or titled in Claude Code; a team set on an unnamed session waits", () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const names = new Names(store.db);
    names.assign("a", { project: "app" });
    names.assign("b", { project: "app" });
    names.assign("c", { project: "app" });
    names.rename("b", "minha sessão");
    names.adoptTitle("c", "fd-coordinator", "custom");
    names.setTeam("a", { name: "md-server", role: "worker", number: 3 });
    expect(() => names.setTeam("nobody", { name: "x", role: "worker", number: 1 })).not.toThrow();
    names.assign("nobody", {
      project: "app",
      team: { name: "md-server", role: "coordinator", number: null },
    });
    expect([
      ["a", "b", "c"].map((id) => names.get(id)?.standard),
      names.get("a")?.team,
      names.get("a")?.aliases,
      names.get("b")?.team ?? "no team",
      names.get("nobody")?.team,
    ]).toEqual([
      [true, false, false],
      { name: "md-server", role: "worker", number: 3 },
      ["app-geral-1"],
      "no team",
      { name: "md-server", role: "coordinator", number: null },
    ]);
  });
});
