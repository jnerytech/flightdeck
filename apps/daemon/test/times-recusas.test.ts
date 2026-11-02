import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
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
