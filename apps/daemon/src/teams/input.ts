/**
 * What a person asks of a team (the protocol's `teams.create` and `teams.update`, as the service
 * takes them): the shape of the request, apart from what the service does with it.
 */
import type { EffortLevel, PermissionMode } from "@flightdeck/protocol";

export interface NewTeam {
  projectId: string;
  goal: string;
  name?: string;
  workers: number;
  coordinatorPersona?: string;
  workerPersonas?: string[];
  /** The model of the coordinator and of each worker; none or null is the persona's own. */
  coordinatorModel?: string;
  workerModels?: Array<string | null>;
  /** Issue #2310: the effort of the coordinator and of each worker; none or null is the persona's own. */
  coordinatorEffort?: EffortLevel;
  workerEfforts?: Array<EffortLevel | null>;
  /** Issue #93: the permission mode of the coordinator and of each worker; none or null is the default. */
  coordinatorPermission?: PermissionMode;
  workerPermissions?: Array<PermissionMode | null>;
  checks?: string[];
}

export interface TeamPatch {
  team: string;
  goal?: string;
  checks?: string[];
  persona?: { member: string; persona: string | null };
  addWorkers?: number;
  /** One more worker with the persona and model asked for (none or null is the default). */
  addMember?: {
    persona?: string | null;
    model?: string | null;
    effort?: EffortLevel | null;
    permission?: PermissionMode | null;
  };
  removeMember?: string;
}
