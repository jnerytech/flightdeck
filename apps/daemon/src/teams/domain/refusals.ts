/**
 * What a team refuses (#1589): the guards of `Teams` as functions over plain inputs, each throwing the
 * same `FlightdeckError` (code, reason and params) the class threw inline. The order of the checks stays
 * in the class; a guard here only decides one of them.
 */
import type { PermissionMode, TeamInfo } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import type { TeamRow } from "./stored.ts";

type Params = Record<string, string | number>;

const bad = (message: string, reason?: string, params?: Params) =>
  new FlightdeckError("bad_request", message, reason, params);
const invalid = (message: string, reason?: string, params?: Params) =>
  new FlightdeckError("invalid_state", message, reason, params);
const notFound = (message: string, reason?: string, params?: Params) =>
  new FlightdeckError("not_found", message, reason, params);

export const teamNotFound = (id: string) =>
  notFound(`team ${id} does not exist`, "team_not_found", { id });

export const personaUnknown = (id: string) =>
  bad(`persona ${id} does not exist`, "persona_unknown", { persona: id });

export const memberUnknown = (who: string) =>
  notFound(`the team has no member ${who}`, "team_member_unknown", { member: who });

/**
 * Refuses a team that asks for a mode without permission prompts on a host that forbids it, before
 * anything starts: the coordinator would otherwise be up when the first worker is turned away.
 */
export function refuseBypass(
  modes: ReadonlyArray<PermissionMode | null | undefined>,
  allowed: () => boolean,
): void {
  if (!modes.includes("bypassPermissions") || allowed()) return;
  throw new FlightdeckError(
    "invalid_permission_update",
    "this host does not allow sessions without permission prompts",
    "bypass_not_allowed",
  );
}

/** Only the team's coordinator writes its outcome or manages its members: the host checks, not the prompt. */
export function refuseNotCoordinator(
  row: TeamRow,
  coordinator: string | null | undefined,
  asker: string,
  action: "report" | "manage",
): void {
  if (coordinator && asker === coordinator) return;
  throw invalid(
    action === "report"
      ? `only the coordinator of team ${row.name} reports its outcome`
      : `only the coordinator of team ${row.name} adds or removes its members`,
    action === "report" ? "team_report_not_coordinator" : "team_manage_not_coordinator",
    { team: row.name },
  );
}

export function refusePaused(row: TeamRow): void {
  if (row.state !== "paused") return;
  throw invalid(`team ${row.name} is paused: resume it before adding`, "team_paused", {
    name: row.name,
  });
}

export function refuseClosed(row: TeamRow): void {
  if (row.state !== "closed") return;
  throw invalid(`team ${row.name} is closed`, "team_closed", { name: row.name });
}

/** Refuses, never queues, while the plan quota is over its limit. */
export function refuseBlockedQuota(
  blocked: { until: number | null } | null | undefined,
  later: string,
): void {
  if (!blocked) return;
  const until = blocked.until ? new Date(blocked.until).toISOString() : "the next reset";
  const message = `the plan quota is over the limit until ${until}: ${later}`;
  throw blocked.until
    ? invalid(message, "team_quota_until", { until })
    : invalid(message, "team_quota_over");
}

/** Reading a team's state with `asker`: only a member of the team may. */
export function refuseForeign(team: TeamInfo, asker: string | undefined): void {
  if (asker === undefined || team.members.some((m) => m.sessionId === asker)) return;
  throw invalid(`this session is not in team ${team.name}`, "team_session_foreign", {
    team: team.name,
  });
}

export function refuseUnconfirmedClose(row: TeamRow, confirm: boolean): void {
  if (confirm) return;
  throw invalid(`closing team ${row.name} needs confirm: true`, "team_close_confirm", {
    name: row.name,
  });
}

/** Only a closed team is deleted. */
export function refuseDeleteOpen(row: TeamRow): void {
  if (row.state === "closed") return;
  throw invalid(`team ${row.name} is still open: close it first`, "team_delete_open", {
    name: row.name,
  });
}

/** A member at work (running, or waiting for an answer) holds the delete back; one that rests does not. */
export function refuseDeleteLive(row: TeamRow, info: TeamInfo): void {
  const working = info.members.filter(
    (m) => m.sessionState === "running" || m.sessionState === "waiting",
  );
  if (working.length === 0) return;
  throw invalid(`team ${row.name} has members at work`, "team_delete_live", {
    name: row.name,
    members: working.length,
  });
}

export function refuseFull(row: TeamRow, workers: number, max: number): void {
  if (workers < max) return;
  throw invalid(`team ${row.name} already has ${workers} workers`, "team_full", {
    name: row.name,
    workers,
  });
}

export function refuseDroppingCoordinator(): never {
  throw invalid(
    "the coordinator does not leave the team: close the team",
    "team_coordinator_stays",
  );
}
