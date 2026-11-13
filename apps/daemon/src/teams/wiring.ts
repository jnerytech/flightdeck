import type { Database } from "bun:sqlite";
import type { Central, ProjectKeys } from "../central/index.ts";
import type { Config } from "../config.ts";
import { present } from "../kernel/index.ts";
import { Idle, LocalEndpoints, type LocalEndpointsOptions, Messaging } from "../messaging/index.ts";
import { type Names, type TrackOptions, trackNames, warmKnown } from "../names/index.ts";
import { OpenSessionPersonas, type Personas, type Prepare } from "../personas/index.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { Teams, type TeamsOptions } from "./teams.ts";

/** What the sessions that work together are built from. */
export interface TeamsWiringDeps {
  db: Database;
  config: Pick<Config, "hostName" | "allowBypassPermissions">;
  manager: TeamsOptions["manager"];
  board: TeamsOptions["board"];
  central: Central;
  keys: Pick<ProjectKeys, "known" | "lookup">;
  autoApprove: LocalEndpointsOptions["autoApprove"];
  names: Names;
  personaStore: Personas;
  /** Prepares the personas of a coordinator this wiring starts. */
  prepare: Prepare;
  quota: TeamsOptions["quota"];
}

/**
 * The sessions that work together (phases 20 and 21, issue #1593): the messages between them, the
 * teams, the personas they open in, and the names they are known by. Its module (issue #2094)
 * serves the `messaging` and `personas` groups, sweeps the messages every 5 minutes, and stops the
 * names, the teams, the idle notices, the messages and the endpoints in that order.
 */
export async function createTeams({
  db,
  config,
  manager,
  board,
  central,
  keys,
  autoApprove,
  names,
  personaStore,
  prepare,
  quota,
}: TeamsWiringDeps) {
  // Of a managed session only: the id of a terminal session is not one the manager knows.
  const cardOf = (sessionId: string) => {
    const cwd = manager.list().find((s) => s.id === sessionId)?.cwd;
    return cwd ? (board.projectForCwd(cwd)?.card?.id ?? null) : null;
  };
  // Phase 21: messages between sessions, delivered here and carried between hosts by the app.
  const endpoints = new LocalEndpoints({
    manager,
    external: central.external,
    nameOf: (claudeSessionId) => central.meta.get(claudeSessionId).name,
    projectKey: (cwd) => keys.known(cwd),
    cardOf,
    sendToLaunch: central.sendToLaunch.bind(central),
    autoApprove,
  });
  // The messaging service asks the teams who is on one, and the teams need the messaging service.
  let teams: Teams | undefined;
  const messaging = new Messaging({
    db,
    host: config.hostName,
    endpoints,
    names,
    teamOf: (sessionId) => teams?.teamOf(sessionId) ?? null,
  });
  // Phase 20's personas reach the team: the coordinator and each worker open in theirs.
  const personaSessions = new OpenSessionPersonas({ personas: personaStore, manager, central });
  teams = new Teams({
    db,
    board,
    manager,
    messaging,
    host: config.hostName,
    quota,
    names,
    personas: {
      resolve: async (id) => {
        try {
          return { id, name: (await personaStore.resolve({ id }, {})).persona.name };
        } catch (error) {
          // A persona that cannot be read is not one that does not exist: the cause stays in the log.
          console.error(`[flightdeckd] persona ${id} could not be read:`, error);
          return null;
        }
      },
    },
    bypassAllowed: () => config.allowBypassPermissions,
    startCoordinator: async ({ cwd, prompt, name, persona, model, effort, permissionMode }) => {
      const ref = persona ? { id: persona } : undefined;
      return manager.create(
        {
          cwd,
          prompt,
          name,
          ...(ref ? { persona: ref } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(permissionMode ? { permissionMode } : {}),
        },
        { prepared: await prepare(ref, cwd) },
      );
    },
    // The worker's model travels on its card (see `Teams.startWorker`).
    startWorker: (cardId, persona) =>
      board.startCard(cardId, persona ? { persona: { id: persona } } : {}),
    warm: (cwd) => warmKeys(cwd),
    applyPersona: (sessionId, persona) => {
      const done = persona
        ? personaSessions.apply({ sessionId, persona: { id: persona } })
        : personaSessions.clear({ sessionId });
      // A session that ended keeps the persona it had; the team still records the new one.
      void done.catch(() => {});
    },
  });
  // A session is named after its project, or after the card's project when it runs in a worktree.
  const keyedPath = (cwd: string) => board.projectForCwd(cwd)?.project.path ?? cwd;
  // Both folders, without blocking: naming, lists and messages read their keys right after. Nothing
  // back when both are known, so whoever starts a session can read its name at once.
  const warmKeys = (cwd: string) => {
    const looked = [cwd, keyedPath(cwd)].map((folder) => keys.lookup(folder));
    return looked.every((key) => typeof key === "string")
      ? undefined
      : Promise.all(looked.map((key) => Promise.resolve(key)));
  };
  const nameOptions: TrackOptions = {
    names,
    manager,
    external: central.external,
    projectOf: (cwd) => keys.known(keyedPath(cwd)),
    warm: warmKeys,
    cardOf,
    personaOf: (sessionId) => {
      const card = cardOf(sessionId);
      return card ? (teams?.personaOfCard(card) ?? null) : null;
    },
    // Issue #101: a worker's session is named with its team, role and number from the start.
    ...present({ teamOfCard: teams?.teamOfCard.bind(teams) }),
  };
  await warmKnown(nameOptions);
  const stopNames = trackNames(nameOptions);
  const idle = new Idle({ endpoints, messaging, host: config.hostName });
  let sweep: ReturnType<typeof setInterval> | undefined;
  const module: DomainModule<"messaging" | "personas"> = {
    server: {
      messaging: serverGroup<"messaging">()({ messages: messaging, idle, teams }),
      personas: serverGroup<"personas">()({ store: personaStore, sessions: personaSessions }),
    },
    start: () => {
      sweep = setInterval(messaging.sweep.bind(messaging), 5 * 60_000);
    },
    stop: () => {
      clearInterval(sweep);
      stopNames();
      teams.stop();
      idle.stop();
      messaging.stop();
      endpoints.stop();
    },
  };
  return { modules: [module] as const };
}
