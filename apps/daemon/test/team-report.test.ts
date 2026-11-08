import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamsUpdatedFrame } from "@flightdeck/protocol";
import { ExternalSessions } from "../src/central/external.ts";
import type { FlightdeckError } from "../src/errors.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { Messaging } from "../src/messaging/messages.ts";
import { startServer } from "../src/server.ts";
import { Teams } from "../src/teams/teams.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "team-report-token-0123456789ab";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #1220: the coordinator says the team's outcome with `team_report`. The daemon keeps its
 * last report as the team's outcome, and only the team's coordinator may write it, whatever the
 * prompt says; a final one (`done`) tells the watchers, so the app can notify the person.
 */
async function boot() {
  const ctx = newBoard({}, 1);
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
  const team = await teams.create({
    goal: "Implement the login with tests.",
    workers: 1,
    projectId: project.id,
    name: "login",
  });
  const coordinator = team.members.find((m) => m.role === "coordinator")?.sessionId ?? "";
  const worker = team.members.find((m) => m.role === "worker");
  return { teams, server, team, coordinator, worker };
}

const refused = async (call: () => unknown) => {
  try {
    await call();
  } catch (error) {
    const { reason } = error as FlightdeckError;
    return reason;
  }
  return "ok";
};

describe("team-report: the coordinator's outcome of the team (#1220)", () => {
  test("its report is the team's outcome; only a final one tells the watchers it is done", async () => {
    const { teams, team, coordinator } = await boot();
    const frames: TeamsUpdatedFrame[] = [];
    cleanups.push(teams.watch((frame) => frames.push(frame)));
    teams.report(team.id, coordinator, "Login form and API done; tests pass.", false);
    const progress = teams.status(team.id).outcome;
    teams.report(team.id, coordinator, "Done: login merged in PR #12.", true);
    const done = teams.status(team.id).outcome;
    expect([
      progress && { text: progress.text, done: progress.done },
      done && { text: done.text, done: done.done, at: typeof done.at },
      frames.map((frame) => frame.event ?? null),
    ]).toEqual([
      { text: "Login form and API done; tests pass.", done: false },
      { text: "Done: login merged in PR #12.", done: true, at: "string" },
      [null, "report_done"],
    ]);
  });

  test("a final report repeated tells the watchers once; a closed team takes no report", async () => {
    const { teams, team, coordinator } = await boot();
    const frames: TeamsUpdatedFrame[] = [];
    cleanups.push(teams.watch((frame) => frames.push(frame)));
    teams.report(team.id, coordinator, "Done.", true);
    teams.report(team.id, coordinator, "Done, as I said.", true);
    teams.close(team.id, true);
    expect([
      frames.filter((frame) => frame.event === "report_done").length,
      await refused(() => teams.report(team.id, coordinator, "One more thing.", true)),
      teams.status(team.id).outcome?.text,
    ]).toEqual([1, "team_closed", "Done, as I said."]);
  });

  test("a worker or a session outside the team cannot write it, and nothing is kept", async () => {
    const { teams, team, worker } = await boot();
    expect([
      await refused(() => teams.report(team.id, worker?.sessionId ?? "", "I finished.", true)),
      await refused(() => teams.report(team.id, "stranger", "Hello.", true)),
      teams.status(team.id).outcome ?? null,
    ]).toEqual(["team_report_not_coordinator", "team_report_not_coordinator", null]);
  });

  test("over the protocol, the asking session is the daemon's, and a report is capped in length", async () => {
    const { server, teams, team, coordinator } = await boot();
    // The worker's card starts its session after the team is made: a real member that is not the
    // coordinator, so the refusal is the host's check of the role.
    const worker = await poll(() =>
      teams.status(team.id).members.find((m) => m.role === "worker" && m.sessionId),
    );
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const send = async (session: string, text: string) => {
      const ack = await client.request("teams.report", {
        team: team.id,
        text,
        done: true,
        as: { session },
      });
      const error = ack.error as { reason?: string; params?: { field?: string } } | undefined;
      return ack.ok === true
        ? "ok"
        : `${error?.reason}${error?.params?.field ? `:${error.params.field}` : ""}`;
    };
    expect([
      await send(worker?.sessionId ?? "", "Done."),
      await send(coordinator, "x".repeat(4001)),
      await send(coordinator, "Done."),
    ]).toEqual(["team_report_not_coordinator", "request_invalid:text", "ok"]);
  });
});
