/**
 * Phase 21: teams. A coordinator session and workers with cards of their own, started together
 * with the instructions of coordination, paused by the plan quota and resumed with it.
 */
import type { Database } from "bun:sqlite";
import type { TeamInfo, TeamStatus, TeamsUpdatedFrame } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { Messaging } from "../messaging/messages.ts";
import type { Quota } from "../quota/quota.ts";
import type { SessionManager } from "../sessions/session-manager.ts";

/** The personas of phase 20 plug in here. */
export interface TeamPersonas {
  resolve(id: string): { id: string; name: string } | null;
}

export interface TeamsOptions {
  db: Database;
  board: Board;
  manager: SessionManager;
  messaging: Messaging;
  host: string;
  quota?: Pick<Quota, "watch" | "blocked"> | undefined;
  personas?: TeamPersonas | undefined;
  clock?: (() => number) | undefined;
  /** Starts the coordinator session; phase 20 passes the persona on. */
  startCoordinator?:
    | ((input: { cwd: string; prompt: string; name: string; persona: string | null }) => {
        sessionId: string;
      })
    | undefined;
  /** Starts a worker's card; phase 20 passes the persona on. */
  startWorker?: ((cardId: string, persona: string | null) => Promise<unknown>) | undefined;
  /** Tells a running session its persona changed. */
  applyPersona?: ((sessionId: string, persona: string | null) => void) | undefined;
}

export interface NewTeam {
  projectId: string;
  goal: string;
  name?: string | undefined;
  workers: number;
  coordinatorPersona?: string | undefined;
  workerPersonas?: string[] | undefined;
  checks?: string[] | undefined;
}

export interface TeamPatch {
  team: string;
  goal?: string | undefined;
  checks?: string[] | undefined;
  persona?: { member: string; persona: string | null } | undefined;
  addWorkers?: number | undefined;
  removeMember?: string | undefined;
}

export class Teams {
  constructor(private readonly opts: TeamsOptions) {}

  async create(_input: NewTeam): Promise<TeamInfo> {
    return {} as TeamInfo;
  }

  list(_projectId?: string): TeamInfo[] {
    return [];
  }

  get(_id: string): TeamInfo {
    return {} as TeamInfo;
  }

  status(_id: string): TeamStatus {
    return {} as TeamStatus;
  }

  async update(_patch: TeamPatch): Promise<TeamInfo> {
    return {} as TeamInfo;
  }

  pause(_id: string): TeamInfo {
    return {} as TeamInfo;
  }

  resume(_id: string): TeamInfo {
    return {} as TeamInfo;
  }

  close(_id: string, _confirm: boolean): TeamInfo {
    return {} as TeamInfo;
  }

  /** A message from Flightdeck to every member. */
  message(_id: string, _text: string): { delivered: number; refused: number } {
    return { delivered: 0, refused: 0 };
  }

  /** The team a session belongs to (as coordinator or worker), if any. */
  teamOf(_sessionId: string): string | null {
    return null;
  }

  watch(_listener: (frame: TeamsUpdatedFrame) => void): () => void {
    return () => {};
  }

  stop(): void {}
}
