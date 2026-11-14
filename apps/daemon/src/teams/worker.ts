/** What a worker of a team is started with, and the size of a team. */

import type { EffortLevel, PermissionMode } from "@flightdeck/protocol";
import type { StoredMember } from "./stored.ts";

/** What a worker is started with beyond the team's own setup; read only, so one copy serves every call. */
export interface WorkerSpec {
  readonly persona: string | null;
  readonly model: string | null;
  readonly effort: EffortLevel | null;
  readonly permission: PermissionMode | null;
  /** #2090: what the coordinator tells this worker up front; it goes in the card after the standard instructions. */
  readonly brief?: string;
}
/** A team holds at most this many workers, besides its coordinator (the cap of `teams.create`). */
export const MAX_WORKERS = 8;
export const NO_SPEC: WorkerSpec = { persona: null, model: null, effort: null, permission: null };

/** One worker to start: its name, who it reports to, and what it is started with (null: the default). */
export interface WorkerStart extends WorkerSpec {
  readonly name: string;
  readonly coordinator: string | null;
  readonly number: number | null;
}

/** A worker's number: the one it was stored with, or (a team saved before #101) its name's. */
export function numberOf(member: StoredMember): number | null {
  if (member.role !== "worker") return null;
  if (typeof member.number === "number") return member.number;
  const parsed = /executora (\d+)$/.exec(member.name)?.[1];
  return parsed ? Number(parsed) : null;
}
