import type { ExternalPermissionFrame } from "@flightdeck/protocol";
import type { ApprovalRequest } from "@/features/permissions/index.ts";
import { basename } from "../../lib/paths.ts";

/**
 * What a session opened outside Flightdeck shows as its title: the name the person gave it,
 * else its folder's name. Never the raw id: a session just opened has neither until its first
 * events, and then `untitled` stands in.
 */
export function externalTitle(
  name: string | null | undefined,
  cwd: string | null | undefined,
  untitled: string,
): string {
  return name ?? (cwd ? basename(cwd) : untitled);
}

/** The open requests of one terminal session, from the host's queue keyed `hostId/requestId`. */
export function externalRequestsOf(
  queue: Record<string, ExternalPermissionFrame>,
  hostId: string,
  claudeSessionId: string,
): ExternalPermissionFrame[] {
  return Object.entries(queue)
    .filter(
      ([key, request]) =>
        key.startsWith(`${hostId}/`) && request.claudeSessionId === claudeSessionId,
    )
    .map(([, request]) => request);
}

/** A terminal session's permission request as the approval card shows it. */
export function approvalRequestOf(
  request: ExternalPermissionFrame,
  cwd: string | null,
): ApprovalRequest {
  return {
    requestId: request.requestId,
    toolName: request.toolName,
    input: request.input,
    cwd,
    createdAt: request.createdAt,
    ...(request.suggestions ? { suggestions: request.suggestions } : {}),
    ...(request.risk ? { risk: request.risk } : {}),
    ...(request.riskReason ? { riskReason: request.riskReason } : {}),
  };
}
