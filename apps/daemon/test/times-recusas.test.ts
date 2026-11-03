import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import type { FlightdeckError } from "../src/errors.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { startServer } from "../src/server.ts";
import { Teams } from "../src/teams/teams.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "times-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function boot() {
  const ctx = newBoard({}, 1);
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
  });
  cleanups.push(() => messaging.stop());
  const teams = new Teams({
    db: ctx.store.db,
    board: ctx.board,
    manager: ctx.manager,
    messaging,
    host: "pc",
  });
  ref = teams;
  cleanups.push(() => teams.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    messaging,
    teams,
    hostName: "pc",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  return { ...ctx, project, teams, messaging, server };
}

async function connect(url: string) {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

const refusal = (ack: Record<string, unknown>) =>
  ack.error as { code: string; reason?: string; params?: Record<string, unknown> };

describe("times-recusas: every refusal of the teams says why", () => {
  test("a request with a field of the wrong kind names the field", async () => {
    const { server } = await boot();
    const client = await connect(server.url);
    const error = refusal(
      await client.request("teams.create", { projectId: "p", goal: "x", workers: "two" }),
    );
    expect(error.code).toBe("bad_request");
    expect(error.reason).toBe("request_invalid");
    expect(error.params).toEqual({ command: "teams.create", field: "workers" });
  });

  test("a project the host does not have", async () => {
    const { server } = await boot();
    const client = await connect(server.url);
    const error = refusal(
      await client.request("teams.create", { projectId: "nope", goal: "x", workers: 1 }),
    );
    expect(error.code).toBe("not_found");
    expect(error.reason).toBe("project_not_found");
  });

  test("a persona the host does not have", async () => {
    const { server, project } = await boot();
    const client = await connect(server.url);
    const error = refusal(
      await client.request("teams.create", {
        projectId: project.id,
        goal: "x",
        workers: 1,
        coordinatorPersona: "ghost",
      }),
    );
    expect(error.reason).toBe("persona_unknown");
    expect(error.params).toEqual({ persona: "ghost" });
  });

  test("a team that does not exist", async () => {
    const { server } = await boot();
    const client = await connect(server.url);
    const missing = refusal(await client.request("teams.pause", { team: "nope" }));
    expect(missing.reason).toBe("team_not_found");
    expect(missing.params).toEqual({ id: "nope" });
  });
});

describe("times-recusas: the refusals about a team's state", () => {
  const NEW = { goal: "Implement the login with tests.", workers: 1 };
  const refused = async (call: () => unknown) => {
    try {
      await call();
    } catch (error) {
      const { code, reason, params } = error as FlightdeckError;
      return { code, reason, params };
    }
    throw new Error("it did not refuse");
  };

  test("a session that is not of the team, a close without confirm, the coordinator leaving", async () => {
    const { teams, project } = await boot();
    const team = await teams.create({ ...NEW, projectId: project.id, name: "login" });
    expect(await refused(() => teams.status(team.id, "stranger"))).toEqual({
      code: "invalid_state",
      reason: "team_session_foreign",
      params: { team: "login" },
    });
    expect(await refused(() => teams.close(team.id, false))).toEqual({
      code: "invalid_state",
      reason: "team_close_confirm",
      params: { name: "login" },
    });
    const coordinator = team.members.find((m) => m.role === "coordinator");
    expect(
      await refused(() => teams.update({ team: team.id, removeMember: coordinator?.name })),
    ).toEqual({ code: "invalid_state", reason: "team_coordinator_stays", params: undefined });
  });

  test("a team that was closed accepts nothing", async () => {
    const { teams, project } = await boot();
    const team = await teams.create({ ...NEW, projectId: project.id, name: "login" });
    teams.close(team.id, true);
    expect(await refused(() => teams.pause(team.id))).toEqual({
      code: "invalid_state",
      reason: "team_closed",
      params: { name: "login" },
    });
  });
});
