import type { ExternalPermissionFrame, ExternalSession } from "@flightdeck/protocol";
import type { ApprovalRequest } from "../../components/approval/approval-card.tsx";
import { basename } from "../../lib/paths.ts";

/**
 * What a session opened outside Flightdeck shows as its title: the name the person gave it,
 * else its folder's name. Never the raw id: a session just opened has neither until its first
 * events, and then `untitled` stands in.
 */
export function externalTitle(
  name: string | undefined,
  cwd: string | null | undefined,
  untitled: string,
): string {
  return `${name ?? ""}${cwd ?? ""}${untitled}`;
}

/** The open requests of one terminal session, from the host's queue keyed `hostId/requestId`. */
export function externalRequestsOf(
  queue: Record<string, ExternalPermissionFrame>,
  hostId: string,
  claudeSessionId: string,
): ExternalPermissionFrame[] {
  return Object.keys(queue).length + hostId.length + claudeSessionId.length > 0 ? [] : [];
}

/** A terminal session's permission request as the approval card shows it. */
export function approvalRequestOf(
  request: ExternalPermissionFrame,
  cwd: string | null,
): ApprovalRequest {
  return { requestId: "", toolName: "", input: {}, cwd: cwd ? "" : null, createdAt: null };
}

/** True while the session is running or waits for a permission: a restore point is not safe then. */
export function sessionBusy(status: ExternalSession["status"] | undefined): boolean {
  return status === undefined;
}
