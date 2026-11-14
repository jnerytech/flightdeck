import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamsUpdatedFrame } from "@flightdeck/protocol";
import { ExternalSessions } from "../../src/central/external.ts";
import type { FlightdeckError } from "../../src/kernel/errors.ts";
import { LocalEndpoints } from "../../src/messaging/endpoints.ts";
import { Messaging } from "../../src/messaging/messages.ts";
import { Quota } from "../../src/quota/quota.ts";
import { startServer } from "../../src/server.ts";
import { Teams } from "../../src/teams/teams.ts";
import { cardWhen, newBoard } from "../support/board-helpers.ts";
import { poll } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "team-manage-token-0123456789abc";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #2090: the coordinator adds a worker in a persona it picks, with a brief, and takes one
 * out when it is no longer needed. The host checks who asks, the persona, the pause, the quota and
 * the size of the team before anything starts; the worker's card and branch stay after a removal.
 */
async function boot(workers = 1) {
  const quota = new Quota({ pauseAt: 0.9 });
  cleanups.push(() => quota.stop());
  const ctx = newBoard({ quota }, 1);
  cleanups.push(async () => {
    const cards = ctx.board.getBoard(project.id).columns.flatMap((column) => column.cards);
    await Promise.all(
      cards.map((card) =>
        cardWhen(ctx.board, card.id, (now) =>
          now.runs.every((run) => run.sessionId !== null || run.endedAt !== null),
        ),
      ),
    );
    ctx.board.stop();
  });
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
    quota,
    personas: { resolve: (id) => (id === "qa" ? { id: "qa", name: "QA" } : null) },
  });
  ref = teams;
  cleanups.push(() => teams.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    messaging: { messages: messaging, teams },
    hostName: "pc",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const team = await teams.create({
    goal: "Implement the login with tests.",
    workers,
    projectId: project.id,
    name: "login",
  });
  const coordinator = team.members.find((m) => m.role === "coordinator")?.sessionId ?? "";
  const first = team.members.find((m) => m.role === "worker");
  return { teams, server, quota, ctx, team, coordinator, first, messaging };
}

const refused = async (call: () => unknown) => {
  try {
    await call();
  } catch (error) {
    return (error as FlightdeckError).reason;
  }
  return "ok";
};

const workersOf = (teams: Teams, id: string) =>
  teams
    .get(id)
    .members.filter((m) => m.role === "worker")
    .map((m) => m.name);

describe("team-manage: the coordinator adds and removes a member (#2090)", () => {
  test("a worker is added in the persona asked for, its card carries the brief after the standard instructions, and the watchers hear", async () => {
    const { teams, ctx, team, coordinator } = await boot();
    const frames: TeamsUpdatedFrame[] = [];
    cleanups.push(teams.watch((frame) => frames.push(frame)));
    const added = await teams.addMember(team.id, coordinator, {
      persona: "qa",
      brief: "Check the login form against the a11y list.",
    });
    const card = added.member.cardId ? ctx.board.getCard(added.member.cardId) : null;
    expect([
      added.member.name,
      added.member.persona,
      added.member.role,
      added.member.permission,
      workersOf(teams, team.id),
      card?.description.includes("espere a tarefa"),
      card?.description.endsWith("Check the login form against the a11y list.\n"),
      frames.at(-1)?.team.members.length,
    ]).toEqual([
      "login · executora 2",
      "qa",
      "worker",
      null,
      ["login · executora 1", "login · executora 2"],
      true,
      true,
      3,
    ]);
  });

  test("only the team's coordinator may ask, and the persona must exist; nothing is added when refused", async () => {
    const { teams, team, coordinator, first } = await boot();
    const worker = await poll(() =>
      teams.status(team.id).members.find((m) => m.role === "worker" && m.sessionId),
    );
    const ask = (asker: string, persona?: string) =>
      refused(() =>
        teams.addMember(team.id, asker, { ...(persona ? { persona } : {}), brief: "x" }),
      );
    expect([
      await ask(worker?.sessionId ?? "", "qa"),
      await ask("stranger", "qa"),
      await ask(coordinator, "ghost"),
      workersOf(teams, team.id),
      first?.name,
    ]).toEqual([
      "team_manage_not_coordinator",
      "team_manage_not_coordinator",
      "persona_unknown",
      ["login · executora 1"],
      "login · executora 1",
    ]);
  });

  test("a paused or closed team takes no member, and the quota refuses instead of queueing", async () => {
    const { teams, quota, team, coordinator } = await boot();
    const ask = () => refused(() => teams.addMember(team.id, coordinator, { brief: "x" }));
    teams.pause(team.id);
    const paused = await ask();
    teams.resume(team.id);
    quota.record([{ window: "five_hour", utilization: 0.95, status: "allowed", resetsAt: null }]);
    const over = await ask();
    quota.record([
      {
        window: "five_hour",
        utilization: 0.95,
        status: "allowed",
        resetsAt: Date.now() + 3_600_000,
      },
    ]);
    const until = await ask();
    teams.close(team.id, true);
    const closed = await ask();
    expect([paused, over, until, closed, workersOf(teams, team.id)]).toEqual([
      "team_paused",
      "team_quota_over",
      "team_quota_until",
      "team_closed",
      ["login · executora 1"],
    ]);
  });

  test("a team keeps at most eight workers; taking one out makes room", async () => {
    const { teams, team, coordinator } = await boot(8);
    const full = await refused(() => teams.addMember(team.id, coordinator, { brief: "x" }));
    await teams.removeMember(team.id, coordinator, "login · executora 8");
    const room = await refused(() => teams.addMember(team.id, coordinator, { brief: "x" }));
    expect([full, room, workersOf(teams, team.id).length]).toEqual(["team_full", "ok", 8]);
  });

  test("two members asked for at once do not pass the cap together, and a removal during an add is not lost", async () => {
    const { teams, team, coordinator } = await boot(7);
    const both = await Promise.all([
      refused(() => teams.addMember(team.id, coordinator, { brief: "a" })),
      refused(() => teams.addMember(team.id, coordinator, { brief: "b" })),
    ]);
    const names = workersOf(teams, team.id);
    const [removal, addition] = await Promise.all([
      refused(() => teams.removeMember(team.id, coordinator, "login · executora 8")),
      refused(() => teams.addMember(team.id, coordinator, { brief: "c" })),
    ]);
    const after = workersOf(teams, team.id);
    expect([
      both.includes("ok"),
      both.includes("team_full"),
      names.length,
      new Set(names).size,
      removal,
      addition,
      after.length,
      after.includes("login · executora 8"),
    ]).toEqual([true, true, 8, 8, "ok", "ok", 8, true]);
  });

  test("removing a worker stops it and takes it out of the team; its card stays; the coordinator stays", async () => {
    const { teams, ctx, team, coordinator, first } = await boot(2);
    const frames: TeamsUpdatedFrame[] = [];
    cleanups.push(teams.watch((frame) => frames.push(frame)));
    const after = await teams.removeMember(team.id, coordinator, "login · executora 2");
    const card = ctx.board.getBoard(team.projectId).columns.flatMap((c) => c.cards);
    expect([
      after.members.filter((m) => m.role === "worker").map((m) => m.name),
      card.some((c) => c.title === "login · executora 2"),
      frames.at(-1)?.team.members.length,
      await refused(() => teams.removeMember(team.id, coordinator, coordinator)),
      await refused(() => teams.removeMember(team.id, coordinator, "ghost")),
      await refused(() => teams.removeMember(team.id, "stranger", first?.name ?? "")),
    ]).toEqual([
      ["login · executora 1"],
      true,
      2,
      "team_coordinator_stays",
      "team_member_unknown",
      "team_manage_not_coordinator",
    ]);
  });

  test("over the protocol, the asking session is the daemon's, `permission` is not accepted and the brief is capped", async () => {
    const { server, teams, team, coordinator } = await boot();
    const worker = await poll(() =>
      teams.status(team.id).members.find((m) => m.role === "worker" && m.sessionId),
    );
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const call = async (type: string, session: string, extra: Record<string, unknown>) => {
      const ack = await client.request(type, { team: team.id, as: { session }, ...extra });
      const error = ack.error as { reason?: string; params?: { field?: string } } | undefined;
      return ack.ok === true
        ? "ok"
        : `${error?.reason}${error?.params?.field ? `:${error.params.field}` : ""}`;
    };
    expect([
      await call("teams.add_member", worker?.sessionId ?? "", { brief: "x" }),
      await call("teams.add_member", coordinator, { brief: "x".repeat(4001) }),
      await call("teams.add_member", coordinator, { brief: "x", permission: "bypassPermissions" }),
      await call("teams.add_member", coordinator, { brief: "Do the thing." }),
      await call("teams.remove_member", worker?.sessionId ?? "", { member: "login · executora 2" }),
      await call("teams.remove_member", coordinator, { member: "login · executora 2" }),
    ]).toEqual([
      "team_manage_not_coordinator",
      "request_invalid:brief",
      "request_invalid",
      "ok",
      "team_manage_not_coordinator",
      "ok",
    ]);
  });
});
