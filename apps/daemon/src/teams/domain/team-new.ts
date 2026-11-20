/**
 * Issue #3455: what `flightdeckd team new` sends and says, as pure rules. A member is one spec,
 * `persona[:model[:effort[:mode]]]`, where a part left empty keeps the default (the same shape as
 * `card start-arena --variant`).
 */
import type { CommandPayload, EffortLevel, PermissionMode, TeamInfo } from "@flightdeck/protocol";
import type { TeamCliArgs } from "./team-cli-view.ts";

export interface MemberSpec {
  persona?: string;
  model?: string;
  effort?: EffortLevel;
  permission?: PermissionMode;
}

/** One member spec; a part that is not valid, or one part too many, is refused with what it takes. */
export function memberSpec(_text: string): MemberSpec {
  return {};
}

/** The `teams.create` payload for these arguments: only what the person set is sent. */
export function newTeamPayload(
  _args: TeamCliArgs,
  projectId: string,
): CommandPayload<"teams.create"> {
  return { projectId, goal: "", workers: 0 };
}

/** Whether any member of the team runs in `bypassPermissions`: the app asks the person to confirm it. */
export function bypassAsked(_args: TeamCliArgs): boolean {
  return false;
}

/** What `team new` says: the team, and which workers wait in the run queue instead of running. */
export function createdLines(_team: TeamInfo): string[] {
  return [];
}

/** What a `team new` that got no answer may have done. */
export const UNSURE_NEW = "";
