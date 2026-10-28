import type { PendingPermission, SessionStatus } from "@flightdeck/protocol";
import type { Notification } from "../platform/types.ts";
import { STATUS_LABELS } from "./status.ts";

export interface SummarySnapshot {
  status: SessionStatus;
  pendingPermissions: PendingPermission[];
}

const IN_TURN: ReadonlySet<SessionStatus> = new Set(["starting", "running", "awaiting_permission"]);

/**
 * Notifications for the change between two summaries of the same session: each new permission
 * request and the end of a turn. Nothing for the first summary seen or while the window has focus.
 */
export function summaryNotifications(
  prev: SummarySnapshot | undefined,
  next: SummarySnapshot,
  label: string,
  focused: boolean,
): Notification[] {
  if (focused || !prev) return [];
  const known = new Set(prev.pendingPermissions.map((p) => p.requestId));
  const notifications = next.pendingPermissions
    .filter((p) => !known.has(p.requestId))
    .map((p) => ({ title: `${label}: esperando você`, body: `Permitir ${p.toolName}?` }));
  if (IN_TURN.has(prev.status) && next.status === "idle") {
    notifications.push({ title: `${label}: turno concluído`, body: STATUS_LABELS.idle });
  }
  return notifications;
}
