import {
  type EffortLevel,
  inSequence,
  type PermissionMode,
  type SessionTeam,
} from "@flightdeck/protocol";
import { withoutPersonas } from "../personas/index.ts";
import type { NewTeam } from "./domain/input.ts";
import {
  coordinatorInstructions,
  type TeamBrief,
  withCoordinatorBrief,
  workerInstructions,
} from "./domain/instructions.ts";
import type { StoredMember } from "./domain/stored.ts";
import { label, type WorkerStart } from "./domain/worker.ts";
import type { TeamsOptions } from "./options.ts";

export type LaunchOptions = Pick<
  TeamsOptions,
  | "board"
  | "manager"
  | "host"
  | "names"
  | "startCoordinator"
  | "preparePersonas"
  | "startWorker"
  | "warm"
>;

/** The team a launch starts: its checked name and checks, and the project it works in. */
export interface TeamStart {
  name: string;
  checks: string[];
  projectId: string;
  projectPath: string;
}

/**
 * Starts what a team is made of: its coordinator session and its workers' cards with their
 * instructions, and remembers the persona and the team each worker card was started with.
 */
export class Launch {
  /** The persona each worker card was started with, for the standard names. */
  private readonly cardPersonas = new Map<string, string>();
  /** The team, role and number each worker card was started with (issue #101). */
  private readonly cardTeams = new Map<string, SessionTeam>();

  constructor(private readonly opts: LaunchOptions) {}

  cardTeam(cardId: string): SessionTeam | undefined {
    return this.cardTeams.get(cardId);
  }

  /** The persona a worker's card was started with; the standard name reads it. */
  cardPersona(cardId: string): string | null {
    return this.cardPersonas.get(cardId) ?? null;
  }

  setCardPersona(cardId: string, persona: string | null): void {
    if (persona) this.cardPersonas.set(cardId, persona);
    else this.cardPersonas.delete(cardId);
  }

  forgetCardTeam(cardId: string): void {
    this.cardTeams.delete(cardId);
  }

  /**
   * Starts the coordinator, then the workers one at a time, and gives back the members to store.
   * The personas are already checked; the coordinator's session is named as it starts.
   */
  async start(
    input: NewTeam,
    base: TeamStart,
    personas: { coordinator: string | null; workers: Array<string | null> },
  ): Promise<{ sessionId: string; members: StoredMember[] }> {
    const { name, checks, projectId, projectPath } = base;
    const coordinatorModel = input.coordinatorModel ?? null;
    const coordinatorEffort = input.coordinatorEffort ?? null;
    const coordinatorPermission = input.coordinatorPermission ?? null;
    const workerNames = Array.from(
      { length: input.workers },
      (_, i) => `${label(name)} · executora ${i + 1}`,
    );
    const team = { name, goal: input.goal, checks, projectId };

    const prompt = coordinatorInstructions({
      ...team,
      workers: workerNames.map((n, i) => ({
        name: n,
        persona: personas.workers[i] ?? null,
        cardId: null,
      })),
    });
    const startCoordinator =
      this.opts.startCoordinator ??
      (async (start: {
        cwd: string;
        prompt: string;
        name: string;
        model: string | null;
        effort: EffortLevel | null;
        permissionMode: PermissionMode | null;
      }) =>
        this.opts.manager.create(
          {
            cwd: start.cwd,
            prompt: start.prompt,
            name: start.name,
            ...(start.model ? { model: start.model } : {}),
            ...(start.effort ? { effort: start.effort } : {}),
            ...(start.permissionMode ? { permissionMode: start.permissionMode } : {}),
          },
          { prepared: await (this.opts.preparePersonas ?? withoutPersonas)(undefined, start.cwd) },
        ));
    const coordinatorName = `${label(name)} · coordenadora`;
    // The session is named as it starts, and its persona is set on that name right below.
    await this.opts.warm?.(projectPath);
    const { sessionId } = await startCoordinator({
      cwd: projectPath,
      prompt,
      name: coordinatorName,
      persona: personas.coordinator,
      model: coordinatorModel,
      effort: coordinatorEffort,
      permissionMode: coordinatorPermission,
    });
    if (personas.coordinator) this.opts.names?.setPersona(sessionId, personas.coordinator);
    this.opts.names?.setTeam?.(sessionId, { name: label(name), role: "coordinator", number: null });
    const address = `${this.opts.host}/${sessionId}`;
    const members: StoredMember[] = [
      {
        name: coordinatorName,
        role: "coordinator",
        persona: personas.coordinator,
        model: coordinatorModel,
        permission: coordinatorPermission,
        cardId: null,
        sessionId,
      },
    ];
    await inSequence(workerNames.entries(), async ([i, workerName]) => {
      members.push(
        await this.startWorker(team, {
          name: workerName,
          persona: personas.workers[i] ?? null,
          coordinator: address,
          model: input.workerModels?.[i] ?? null,
          number: i + 1,
          permission: input.workerPermissions?.[i] ?? null,
          effort: input.workerEfforts?.[i] ?? null,
        }),
      );
    });
    return { sessionId, members };
  }

  /** Creates a worker's card with its instructions and starts it (the quota queue still applies). */
  async startWorker(
    team: { name: string; goal: string; checks: string[]; projectId: string },
    worker: WorkerStart,
  ): Promise<StoredMember> {
    const { name, persona, coordinator, model, number, permission, effort, brief: told } = worker;
    const brief: TeamBrief = { ...team, workers: [] };
    const card = this.opts.board.createCard(team.projectId, {
      title: name,
      description: withCoordinatorBrief(workerInstructions(brief, coordinator), told),
      // The card's variant is where a card keeps the model, the effort and the mode its session opens in.
      ...(model || effort || permission
        ? { variant: { label: "team", model, effort, persona, permissionMode: permission } }
        : {}),
    });
    // Before the card starts: its session is named with this persona from the first moment.
    if (persona) this.cardPersonas.set(card.id, persona);
    this.cardTeams.set(card.id, { name: label(team.name), role: "worker", number });
    await (this.opts.startWorker
      ? this.opts.startWorker(card.id, persona, model)
      : this.opts.board.startCard(card.id));
    return {
      name,
      role: "worker",
      persona,
      model,
      permission,
      cardId: card.id,
      sessionId: null,
      number,
    };
  }
}
