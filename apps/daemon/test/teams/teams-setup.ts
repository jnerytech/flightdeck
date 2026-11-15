import type { TeamsUpdatedFrame } from "@flightdeck/protocol";
import { ExternalSessions } from "../../src/central/external.ts";
import type { FlightdeckError } from "../../src/kernel/errors.ts";
import { LocalEndpoints } from "../../src/messaging/endpoints.ts";
import { Messaging } from "../../src/messaging/messages.ts";
import { Names } from "../../src/names/names.ts";
import type { TeamsOptions } from "../../src/teams/options.ts";
import { Teams } from "../../src/teams/teams.ts";
import { newBoard } from "../support/board-helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** `realNames`: the team books its members in the host's own names table, not in a fake. */
export async function setup(over: Partial<TeamsOptions> = {}, realNames = false) {
  const ctx = newBoard({}, 1);
  const names = new Names(ctx.store.db);
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
    ...(realNames ? { names } : {}),
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
  return { ...ctx, project, endpoints, messaging, teams, frames, sessionTexts, names };
}

export const failure = async (promise: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return "ok";
  } catch (error) {
    return `${(error as FlightdeckError).code}: ${(error as Error).message}`;
  }
};

export const NEW = { goal: "Implementar o login com testes.", workers: 2 };

export const reasonOf = async (promise: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return "ok";
  } catch (error) {
    return (error as FlightdeckError).reason ?? "none";
  }
};
