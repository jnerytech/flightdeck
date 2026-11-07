import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import type { FlightdeckError } from "../src/errors.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { Teams, type TeamsOptions } from "../src/teams/teams.ts";
import { newBoard, whenChanged } from "./board-helpers.ts";

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
  const messaging = new Messaging({
    db: ctx.store.db,
    host: "pc",
    endpoints,
    teamOf: () => null,
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
  cleanups.push(() => teams.stop());
  return { ...ctx, project, teams };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    const refused = error as FlightdeckError;
    return `${refused.code}: ${refused.reason ?? refused.message}`;
  }
};

const NEW = { goal: "Review the login.", workers: 2 };

describe("times-permissao: a permission mode per member (issue #93)", () => {
  test("each member opens in the mode the team gives it, and none means the host's default", async () => {
    const asked: Array<string | null> = [];
    const { teams, project, board, manager } = await setup({
      startCoordinator: (input) => {
        asked.push(input.permissionMode);
        return manager.create({
          cwd: input.cwd,
          prompt: input.prompt,
          name: input.name,
          ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        });
      },
    });
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      coordinatorPermission: "plan",
      workerPermissions: ["acceptEdits", null],
    });
    expect(asked).toEqual(["plan"]);
    expect(team.members.map((m) => m.permission)).toEqual(["plan", "acceptEdits", null]);
    await whenChanged(board, () =>
      team.members.slice(1).every((m) => board.getCard(m.cardId as string).sessionId),
    );
    const modeOf = (member: { cardId: string | null; sessionId: string | null }) =>
      manager.get(
        (member.cardId ? board.getCard(member.cardId).sessionId : member.sessionId) as string,
      ).permissionMode;
    expect(team.members.map(modeOf)).toEqual(["plan", "acceptEdits", "default"]);
    // The mode is kept with the team, so a later reading shows it too.
    expect(teams.get(team.id).members.map((m) => m.permission)).toEqual([
      "plan",
      "acceptEdits",
      null,
    ]);
  });

  test("a host that forbids bypass refuses the team before any member starts", async () => {
    let started = 0;
    const { teams, project, board, manager } = await setup({
      bypassAllowed: () => false,
      startCoordinator: (input) => {
        started += 1;
        return manager.create({ cwd: input.cwd, prompt: input.prompt, name: input.name });
      },
    });
    expect(
      await failure(
        teams.create({
          ...NEW,
          projectId: project.id,
          workerPermissions: [null, "bypassPermissions"],
        }),
      ),
    ).toBe("invalid_permission_update: bypass_not_allowed");
    expect(
      await failure(
        teams.create({
          ...NEW,
          projectId: project.id,
          coordinatorPermission: "bypassPermissions",
        }),
      ),
    ).toBe("invalid_permission_update: bypass_not_allowed");
    expect(started).toBe(0);
    expect(manager.list()).toEqual([]);
    expect(board.getBoard(project.id).columns.flatMap((c) => c.cards)).toEqual([]);
    expect(teams.list()).toEqual([]);
  });

  test("a host that allows bypass passes it on to the member", async () => {
    const asked: Array<string | null> = [];
    const { teams, project, manager } = await setup({
      bypassAllowed: () => true,
      startCoordinator: (input) => {
        asked.push(input.permissionMode);
        return manager.create({ cwd: input.cwd, prompt: input.prompt, name: input.name });
      },
      startWorker: async () => {},
    });
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      coordinatorPermission: "bypassPermissions",
      workerPermissions: [null, "bypassPermissions"],
    });
    expect(asked).toEqual(["bypassPermissions"]);
    expect(team.members.map((m) => m.permission)).toEqual([
      "bypassPermissions",
      null,
      "bypassPermissions",
    ]);
  });

  test("a worker added to a running team opens in the mode asked, and a forbidden bypass adds nothing", async () => {
    const { teams, project, board, manager } = await setup({ bypassAllowed: () => false });
    const team = await teams.create({ ...NEW, workers: 1, projectId: project.id });
    const cards = () => board.getBoard(project.id).columns.flatMap((c) => c.cards).length;
    const before = cards();
    expect(
      await failure(
        teams.update({ team: team.id, addMember: { permission: "bypassPermissions" } }),
      ),
    ).toBe("invalid_permission_update: bypass_not_allowed");
    expect(cards()).toBe(before);
    const updated = await teams.update({ team: team.id, addMember: { permission: "plan" } });
    const added = updated.members.at(-1);
    expect(added?.permission).toBe("plan");
    await whenChanged(board, () => Boolean(board.getCard(added?.cardId as string).sessionId));
    expect(
      manager.get(board.getCard(added?.cardId as string).sessionId as string).permissionMode,
    ).toBe("plan");
  });
});
