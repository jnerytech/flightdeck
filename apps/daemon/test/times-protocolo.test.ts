import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ExternalSessions } from "../src/central/external.ts";
import { runCli } from "../src/main.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { startServer } from "../src/server.ts";
import { Teams } from "../src/teams/teams.ts";
import { newBoard, whenChanged } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "times-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function boot(options: { teams?: boolean } = {}) {
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
    ...(options.teams === false ? {} : { teams }),
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

describe("times-protocolo", () => {
  test("sem o serviço de times o daemon responde invalid_state", async () => {
    const { server } = await boot({ teams: false });
    const client = await connect(server.url);
    for (const [type, payload] of [
      ["teams.list", {}],
      ["teams.create", { projectId: "p", goal: "x", workers: 1 }],
      ["teams.update", { team: "t", goal: "y" }],
      ["teams.pause", { team: "t" }],
      ["teams.resume", { team: "t" }],
      ["teams.close", { team: "t", confirm: true }],
      ["teams.message", { team: "t", text: "oi" }],
      ["teams.status", { team: "t" }],
      ["teams.watch", {}],
    ] as const) {
      expect(await client.request(type, payload)).toMatchObject({
        ok: false,
        error: { code: "invalid_state" },
      });
    }
  });

  test("criar, listar, ver o estado, pausar, retomar, mandar a todos, trocar o objetivo e encerrar", async () => {
    const { server, project, board } = await boot();
    const app = await connect(server.url);
    await app.request("teams.watch", {});
    const team = await app.data<{
      id: string;
      coordinator: string;
      members: Array<{ cardId: string | null }>;
    }>("teams.create", { projectId: project.id, goal: "Faça o login.", workers: 1, name: "login" });
    expect(team?.id).toBeTruthy();
    await whenChanged(board, () =>
      team?.members.slice(1).every((m) => board.getCard(m.cardId as string).sessionId),
    );
    expect(
      (
        await app.data<{ teams: Array<{ id: string }> }>("teams.list", { projectId: project.id })
      )?.teams.map((t) => t.id),
    ).toEqual([team?.id as string]);
    expect(await app.data("teams.status", { team: team?.id })).toMatchObject({
      team: { id: team?.id },
      messages: 0,
    });
    expect(await app.data("teams.pause", { team: team?.id })).toMatchObject({
      state: "paused",
      pausedBy: "user",
    });
    expect(await app.data("teams.resume", { team: team?.id })).toMatchObject({ state: "active" });
    expect(await app.data("teams.message", { team: team?.id, text: "mudança" })).toEqual({
      delivered: 2,
      refused: 0,
    });
    expect(
      await app.data("teams.update", { team: team?.id, goal: "Novo objetivo." }),
    ).toMatchObject({ goal: "Novo objetivo." });
    expect(await app.request("teams.close", { team: team?.id })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(await app.data("teams.close", { team: team?.id, confirm: true })).toMatchObject({
      state: "closed",
    });
    expect(
      (await poll(() => app.frames.filter((f) => f.type === "teams.updated").length >= 5, 3000)) ??
        false,
    ).toBe(true);
    expect(await app.request("teams.status", { team: "nada" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("mcp-mensagens: team_status", () => {
  async function mcp(session: string, teams: Teams, server: { port: number }) {
    const file = join(tempDir(), "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await runCli(["mcp", "--config", file], {
      env: { FLIGHTDECK_SESSION: session },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
      mcpTransport: serverSide,
    });
    const client = new Client({ name: "teste", version: "1.0.0" });
    await client.connect(clientSide);
    cleanups.push(() => client.close());
    void teams;
    return async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "team_status", arguments: args });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
      return result.isError ? { error: text } : { data: JSON.parse(text) };
    };
  }

  test("um membro do time vê o estado dele; quem não é do time não vê", async () => {
    const { teams, project, manager, board, server } = await boot();
    const team = await teams.create({
      projectId: project.id,
      goal: "Faça o login.",
      workers: 1,
      name: "login",
    });
    await whenChanged(board, () =>
      team.members.slice(1).every((m) => board.getCard(m.cardId as string).sessionId),
    );
    const outsider = manager.create({ cwd: project.path, prompt: "outra coisa" }).sessionId;
    const asMember = await mcp(team.coordinator as string, teams, server);
    const seen = await asMember({ team: team.id });
    expect(seen.data).toMatchObject({ team: { id: team.id, goal: "Faça o login." }, messages: 0 });
    expect(seen.data.members).toHaveLength(2);
    const asOutsider = await mcp(outsider, teams, server);
    expect((await asOutsider({ team: team.id })).error).toContain("não é do time");
    expect((await asMember({ team: "nada" })).error).toContain("not_found");
  });
});
