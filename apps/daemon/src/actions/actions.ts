/**
 * Phase 17: the actions service. An action is a command the user declared, with places for
 * secrets and parameters; Claude calls it by name and only chooses the parameters. The secret is
 * applied on this side and what comes back is masked.
 */
import type { Database } from "bun:sqlite";
import type {
  ActionInfo,
  ActionList,
  ActionResult,
  ActionRunInfo,
  VaultRequester,
  VaultRequestFrame,
  VaultUsed,
} from "@flightdeck/protocol";
import type { Vault } from "../vault/vault.ts";
import type { SshExecutor } from "./run.ts";

/** What the service needs to know of a project. */
export interface ActionProject {
  id: string;
  path: string;
  baseBranch: string;
}

export interface ActionsOptions {
  db: Database;
  vault: Vault;
  /** The project by id; throws `not_found` for one that does not exist. */
  projects: (id: string) => ActionProject;
  /** Where host actions (and free commands) run; the home folder when absent. */
  hostBase?: string | undefined;
  /** The daemon's environment; what reaches a program is cleaned. */
  baseEnv?: Record<string, string | undefined> | undefined;
  /** The SSH destinations of phase 15 plug in here. */
  ssh?: SshExecutor | undefined;
  /** How long a run waits for the app to deliver a secret (2 minutes when absent). */
  requestTimeoutMs?: number | undefined;
  log?: ((message: string) => void) | undefined;
}

export type ActionsFrame = VaultRequestFrame | VaultUsed;

export class Actions {
  constructor(_opts: ActionsOptions) {}

  async list(_projectId?: string): Promise<ActionList> {
    return { actions: [], errors: [] };
  }

  async save(_input: {
    projectId?: string | undefined;
    definition: Record<string, unknown>;
    secretIds?: string[] | undefined;
  }): Promise<ActionInfo> {
    return {} as ActionInfo;
  }

  async remove(_projectId: string | undefined, _name: string): Promise<ActionList> {
    return { actions: [], errors: [] };
  }

  async trust(_projectId: string | undefined, _name: string, _hash: string): Promise<ActionInfo> {
    return {} as ActionInfo;
  }

  async run(_input: {
    projectId?: string | undefined;
    name: string;
    params?: Record<string, string> | undefined;
    requestedBy: VaultRequester;
  }): Promise<ActionResult> {
    return {} as ActionResult;
  }

  async runFree(_input: {
    command: string;
    secrets: string[];
    host?: string | undefined;
    requestedBy: VaultRequester;
  }): Promise<ActionResult> {
    return {} as ActionResult;
  }

  runs(_input: {
    projectId?: string | undefined;
    name?: string | undefined;
    limit?: number | undefined;
  }): ActionRunInfo[] {
    return [];
  }

  /** The app's stream of `vault.request` and `vault.used` frames; answers how to stop it. */
  watch(_listener: (frame: ActionsFrame) => void): () => void {
    return () => {};
  }

  /** The user refused a request: the run that waits for it fails at once. */
  deny(_requestId: string): void {}

  /** Nothing that waits outlives the daemon. */
  stop(): void {}
}
