/** What a `Teams` is built from: the stores it reads and the hooks that start sessions. */

import type { Database } from "bun:sqlite";
import type { EffortLevel, PermissionMode, SessionTeam } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { Messaging } from "../messaging/messages.ts";
import type { Prepare } from "../personas/index.ts";
import type { Quota } from "../quota/index.ts";
import type { SessionManager } from "../sessions/index.ts";

/** The personas of phase 20 plug in here. */
export interface TeamPersonas {
  resolve(
    id: string,
  ): { id: string; name: string } | null | Promise<{ id: string; name: string } | null>;
}

export interface TeamsOptions {
  db: Database;
  board: Board;
  manager: SessionManager;
  messaging: Messaging;
  host: string;
  quota?: Pick<Quota, "watch" | "blocked">;
  personas?: TeamPersonas;
  /** The standard names: a persona that arrives after the session started renames it. */
  names?: {
    get(sessionId: string): unknown;
    setPersona(sessionId: string, persona: string | null): unknown;
    /** Issue #101: the team, role and number a session's name carries. */
    setTeam?(sessionId: string, team: SessionTeam): unknown;
    /** Issue #934: a session whose team was deleted leaves it. */
    clearTeam?(sessionId: string): unknown;
  };
  clock?: () => number;
  /** Issue #93: whether the host lets a session run without permission prompts. */
  bypassAllowed?: () => boolean;
  /** Starts the coordinator session; phase 20 passes the persona on. */
  startCoordinator?: (input: {
    cwd: string;
    prompt: string;
    name: string;
    persona: string | null;
    model: string | null;
    /** Issue #2310: the effort the coordinator opens with; null is the persona's own. */
    effort: EffortLevel | null;
    /** Issue #93: the mode the coordinator opens in; null is the host's default. */
    permissionMode: PermissionMode | null;
  }) => { sessionId: string } | Promise<{ sessionId: string }>;
  /** Reads the personas for the coordinator when `startCoordinator` is not given. */
  preparePersonas?: Prepare;
  /** Starts a worker's card; phase 20 passes the persona on. */
  startWorker?: (cardId: string, persona: string | null, model: string | null) => Promise<unknown>;
  /** Looks the project of the folder up before the coordinator starts there; nothing back means known. */
  warm?: (cwd: string) => Promise<unknown> | undefined;
  /** Tells a running session its persona changed. */
  applyPersona?: (sessionId: string, persona: string | null) => void;
}
